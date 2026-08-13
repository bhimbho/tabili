use base64::{engine::general_purpose::STANDARD, Engine as _};
use sqlx::{Sqlite, SqlitePool};
use std::collections::HashMap;

use crate::db::error::DbError;
use crate::db::types::DbValue;
use super::introspect::quote_ident;

pub(super) type SqliteQuery<'q> = sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments>;

/// NULL is inlined as a SQL literal rather than bound — sidesteps the need for
/// column-type-aware "bind a typed NULL" logic entirely.
pub(super) fn bind_value<'q>(
    query: SqliteQuery<'q>,
    value: &'q DbValue,
) -> Result<SqliteQuery<'q>, DbError> {
    Ok(match value {
        DbValue::Null | DbValue::Now => {
            unreachable!("NULL/CURRENT_TIMESTAMP are inlined as SQL keywords, not bound")
        }
        DbValue::Default => {
            return Err(DbError::Unsupported(
                "SQLite has no DEFAULT keyword in UPDATE — set an explicit value".into(),
            ))
        }
        DbValue::Bool(b) => query.bind(*b),
        DbValue::Int(i) => query.bind(*i),
        DbValue::Float(f) => query.bind(*f),
        DbValue::Decimal(s) | DbValue::Text(s) | DbValue::DateTime(s) | DbValue::Uuid(s) => {
            query.bind(s.as_str())
        }
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

/// SQLite takes NULL and CURRENT_TIMESTAMP as bare keywords but has no `DEFAULT`
/// in UPDATE or VALUES, so that one is deliberately left to `bind_value`, which
/// reports why rather than emitting SQL the server would reject.
fn inline_keyword(value: &DbValue) -> Option<&'static str> {
    match value {
        DbValue::Default => None,
        other => other.inline_keyword(),
    }
}

/// Splits column/value pairs into SQL fragments (placeholder or NULL literal) and
/// the list of non-null values to bind, in matching order.
fn build_assignments<'a>(
    values: &'a HashMap<String, DbValue>,
) -> (Vec<String>, Vec<&'a DbValue>) {
    let mut fragments = Vec::with_capacity(values.len());
    let mut binds = Vec::new();
    for (col, val) in values {
        if let Some(keyword) = inline_keyword(val) {
            fragments.push(format!("{} = {keyword}", quote_ident(col)));
        } else {
            fragments.push(format!("{} = ?", quote_ident(col)));
            binds.push(val);
        }
    }
    (fragments, binds)
}

pub async fn insert_row(
    pool: &SqlitePool,
    table: &str,
    values: &HashMap<String, DbValue>,
) -> Result<String, DbError> {
    let mut columns = Vec::with_capacity(values.len());
    let mut placeholders = Vec::with_capacity(values.len());
    let mut binds = Vec::new();
    for (col, val) in values {
        columns.push(quote_ident(col));
        if let Some(keyword) = inline_keyword(val) {
            placeholders.push(keyword.to_string());
        } else {
            placeholders.push("?".to_string());
            binds.push(val);
        }
    }

    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        quote_ident(table),
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
    pool: &SqlitePool,
    table: &str,
    pk: &HashMap<String, DbValue>,
    changes: &HashMap<String, DbValue>,
) -> Result<String, DbError> {
    if pk.is_empty() {
        return Err(DbError::NoPrimaryKey);
    }
    let (set_fragments, set_binds) = build_assignments(changes);
    let (where_fragments, where_binds) = build_assignments(pk);
    let where_clause = where_fragments.join(" AND ");

    let sql = format!(
        "UPDATE {} SET {} WHERE {}",
        quote_ident(table),
        set_fragments.join(", "),
        where_clause
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
    pool: &SqlitePool,
    table: &str,
    pks: &[HashMap<String, DbValue>],
) -> Result<Vec<String>, DbError> {
    if pks.iter().any(|pk| pk.is_empty()) {
        return Err(DbError::NoPrimaryKey);
    }
    let mut tx = pool.begin().await.map_err(|e| DbError::Query(e.to_string()))?;
    let mut executed = Vec::with_capacity(pks.len());
    for pk in pks {
        let (where_fragments, where_binds) = build_assignments(pk);
        let sql = format!(
            "DELETE FROM {} WHERE {}",
            quote_ident(table),
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
