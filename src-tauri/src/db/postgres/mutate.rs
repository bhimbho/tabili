use base64::{engine::general_purpose::STANDARD, Engine as _};
use rust_decimal::Decimal;
use sqlx::{PgPool, Postgres};
use std::collections::HashMap;
use std::str::FromStr;

use super::introspect::{quote_ident, quote_qualified};
use crate::db::error::DbError;
use crate::db::types::DbValue;

pub(super) type PgQuery<'q> = sqlx::query::Query<'q, Postgres, sqlx::postgres::PgArguments>;

/// Postgres won't implicitly coerce a text bind into uuid/timestamptz/jsonb, and
/// user-defined types (enums, domains) reject it outright. `column_types` maps a
/// column to the type `format_type` reported for it, so string-shaped values are
/// cast to exactly the column's own type — that's what makes enum columns
/// editable. Values that already bind as a native Rust type need no cast.
fn cast_suffix(value: &DbValue, column: &str, column_types: &HashMap<String, String>) -> String {
    let needs_cast = matches!(
        value,
        DbValue::Text(_) | DbValue::Uuid(_) | DbValue::DateTime(_) | DbValue::Json(_)
    );
    if !needs_cast {
        return String::new();
    }
    match column_types.get(column) {
        Some(ty) => format!("::{ty}"),
        // Without type information, fall back to the variant's best guess.
        None => match value {
            DbValue::Uuid(_) => "::uuid".to_string(),
            DbValue::DateTime(_) => "::timestamptz".to_string(),
            DbValue::Json(_) => "::jsonb".to_string(),
            _ => String::new(),
        },
    }
}

/// Column name -> declared type, used to cast bound parameters correctly.
async fn column_types(
    pool: &PgPool,
    schema: &str,
    table: &str,
) -> HashMap<String, String> {
    super::introspect::get_columns(pool, schema, table)
        .await
        .map(|cols| cols.into_iter().map(|c| (c.name, c.data_type)).collect())
        .unwrap_or_default()
}

pub(super) fn bind_value<'q>(
    query: PgQuery<'q>,
    value: &'q DbValue,
) -> Result<PgQuery<'q>, DbError> {
    Ok(match value {
        DbValue::Null | DbValue::Default => {
            unreachable!("NULL/DEFAULT are inlined as SQL keywords, not bound")
        }
        DbValue::Bool(b) => query.bind(*b),
        DbValue::Int(i) => query.bind(*i),
        DbValue::Float(f) => query.bind(*f),
        DbValue::Decimal(s) => {
            let d = Decimal::from_str(s)
                .map_err(|e| DbError::Query(format!("invalid decimal: {e}")))?;
            query.bind(d)
        }
        DbValue::Text(s) | DbValue::DateTime(s) | DbValue::Uuid(s) => query.bind(s.as_str()),
        DbValue::Bytes(b64) => {
            let bytes = STANDARD
                .decode(b64)
                .map_err(|e| DbError::Query(format!("invalid base64: {e}")))?;
            query.bind(bytes)
        }
        DbValue::Json(v) => query.bind(v.to_string()),
        DbValue::Array(_) | DbValue::Unsupported { .. } => {
            return Err(DbError::Unsupported(
                "editing this value type is not supported yet".into(),
            ))
        }
    })
}

/// Splits column/value pairs into SQL fragments (`$n[::cast]` or `NULL`) and the
/// list of non-null values to bind, in matching order. `next_idx` continues the
/// placeholder counter across callers (e.g. SET clauses then WHERE clauses).
fn build_assignments<'a>(
    values: &'a HashMap<String, DbValue>,
    next_idx: &mut usize,
    types: &HashMap<String, String>,
) -> (Vec<String>, Vec<&'a DbValue>) {
    let mut fragments = Vec::with_capacity(values.len());
    let mut binds = Vec::new();
    for (col, val) in values {
        if let Some(keyword) = val.inline_keyword() {
            fragments.push(format!("{} = {keyword}", quote_ident(col)));
        } else {
            fragments.push(format!(
                "{} = ${}{}",
                quote_ident(col),
                next_idx,
                cast_suffix(val, col, types)
            ));
            *next_idx += 1;
            binds.push(val);
        }
    }
    (fragments, binds)
}

pub async fn insert_row(
    pool: &PgPool,
    schema: &str,
    table: &str,
    values: &HashMap<String, DbValue>,
) -> Result<String, DbError> {
    let types = column_types(pool, schema, table).await;
    let mut columns = Vec::with_capacity(values.len());
    let mut placeholders = Vec::with_capacity(values.len());
    let mut binds = Vec::new();
    let mut idx = 1;
    for (col, val) in values {
        columns.push(quote_ident(col));
        if let Some(keyword) = val.inline_keyword() {
            placeholders.push(keyword.to_string());
        } else {
            placeholders.push(format!("${}{}", idx, cast_suffix(val, col, &types)));
            idx += 1;
            binds.push(val);
        }
    }

    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quote_qualified(schema, table),
        columns.join(", "),
        placeholders.join(", ")
    );
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.clone()));
    for val in binds {
        query = bind_value(query, val)?;
    }
    query
        .execute(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
    Ok(sql)
}

pub async fn update_row(
    pool: &PgPool,
    schema: &str,
    table: &str,
    pk: &HashMap<String, DbValue>,
    changes: &HashMap<String, DbValue>,
) -> Result<String, DbError> {
    if pk.is_empty() {
        return Err(DbError::NoPrimaryKey);
    }
    let types = column_types(pool, schema, table).await;
    let mut idx = 1;
    let (set_fragments, set_binds) = build_assignments(changes, &mut idx, &types);
    let (where_fragments, where_binds) = build_assignments(pk, &mut idx, &types);

    let sql = format!(
        "UPDATE {} SET {} WHERE {}",
        quote_qualified(schema, table),
        set_fragments.join(", "),
        where_fragments.join(" AND ")
    );
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.clone()));
    for val in set_binds.into_iter().chain(where_binds) {
        query = bind_value(query, val)?;
    }
    query
        .execute(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
    Ok(sql)
}

pub async fn delete_rows(
    pool: &PgPool,
    schema: &str,
    table: &str,
    pks: &[HashMap<String, DbValue>],
) -> Result<Vec<String>, DbError> {
    if pks.iter().any(|pk| pk.is_empty()) {
        return Err(DbError::NoPrimaryKey);
    }
    let types = column_types(pool, schema, table).await;
    let mut tx = pool.begin().await.map_err(|e| DbError::Query(e.to_string()))?;
    let mut executed = Vec::with_capacity(pks.len());
    for pk in pks {
        let mut idx = 1;
        let (where_fragments, where_binds) = build_assignments(pk, &mut idx, &types);
        let sql = format!(
            "DELETE FROM {} WHERE {}",
            quote_qualified(schema, table),
            where_fragments.join(" AND ")
        );
        let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.clone()));
        for val in where_binds {
            query = bind_value(query, val)?;
        }
        query
            .execute(&mut *tx)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;
        executed.push(sql);
    }
    tx.commit().await.map_err(|e| DbError::Query(e.to_string()))?;
    Ok(executed)
}
