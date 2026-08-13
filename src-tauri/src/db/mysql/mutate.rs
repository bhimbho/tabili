use base64::{engine::general_purpose::STANDARD, Engine as _};
use rust_decimal::Decimal;
use sqlx::{MySql, MySqlPool};
use std::collections::HashMap;
use std::str::FromStr;

use super::introspect::quote_ident;
use crate::db::error::DbError;
use crate::db::types::DbValue;

type MySqlQuery<'q> = sqlx::query::Query<'q, MySql, sqlx::mysql::MySqlArguments>;

/// Unlike Postgres, MySQL doesn't require the bound value's type to match the
/// target column exactly — a plain string bind coerces into DATE, DATETIME,
/// ENUM, SET and JSON columns without an explicit cast, so no per-column type
/// lookup is needed here.
pub(super) fn bind_value<'q>(query: MySqlQuery<'q>, value: &'q DbValue) -> Result<MySqlQuery<'q>, DbError> {
    Ok(match value {
        DbValue::Null => unreachable!("null values are inlined as SQL literals, not bound"),
        DbValue::Bool(b) => query.bind(*b),
        DbValue::Int(i) => query.bind(*i),
        DbValue::Float(f) => query.bind(*f),
        DbValue::Decimal(s) => {
            let d = Decimal::from_str(s).map_err(|e| DbError::Query(format!("invalid decimal: {e}")))?;
            query.bind(d)
        }
        DbValue::Text(s) | DbValue::DateTime(s) | DbValue::Uuid(s) => query.bind(s.as_str()),
        DbValue::Bytes(b64) => {
            let bytes = STANDARD.decode(b64).map_err(|e| DbError::Query(format!("invalid base64: {e}")))?;
            query.bind(bytes)
        }
        DbValue::Json(v) => query.bind(v.to_string()),
        DbValue::Array(_) | DbValue::Unsupported { .. } => {
            return Err(DbError::Unsupported("editing this value type is not supported yet".into()))
        }
    })
}

/// Splits column/value pairs into SQL fragments (placeholder or NULL literal) and
/// the list of non-null values to bind, in matching order.
fn build_assignments<'a>(values: &'a HashMap<String, DbValue>) -> (Vec<String>, Vec<&'a DbValue>) {
    let mut fragments = Vec::with_capacity(values.len());
    let mut binds = Vec::new();
    for (col, val) in values {
        if matches!(val, DbValue::Null) {
            fragments.push(format!("{} = NULL", quote_ident(col)));
        } else {
            fragments.push(format!("{} = ?", quote_ident(col)));
            binds.push(val);
        }
    }
    (fragments, binds)
}

pub async fn insert_row(
    pool: &MySqlPool,
    schema: &str,
    table: &str,
    values: &HashMap<String, DbValue>,
) -> Result<String, DbError> {
    let mut columns = Vec::with_capacity(values.len());
    let mut placeholders = Vec::with_capacity(values.len());
    let mut binds = Vec::new();
    for (col, val) in values {
        columns.push(quote_ident(col));
        if matches!(val, DbValue::Null) {
            placeholders.push("NULL".to_string());
        } else {
            placeholders.push("?".to_string());
            binds.push(val);
        }
    }

    let sql = format!(
        "INSERT INTO {} ({}) VALUES ({})",
        super::introspect::quote_qualified(schema, table),
        columns.join(", "),
        placeholders.join(", ")
    );
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.clone()));
    for val in binds {
        query = bind_value(query, val)?;
    }
    query.execute(pool).await.map_err(|e| DbError::Query(e.to_string()))?;
    Ok(sql)
}

pub async fn update_row(
    pool: &MySqlPool,
    schema: &str,
    table: &str,
    pk: &HashMap<String, DbValue>,
    changes: &HashMap<String, DbValue>,
) -> Result<String, DbError> {
    if pk.is_empty() {
        return Err(DbError::NoPrimaryKey);
    }
    let (set_fragments, set_binds) = build_assignments(changes);
    let (where_fragments, where_binds) = build_assignments(pk);

    let sql = format!(
        "UPDATE {} SET {} WHERE {}",
        super::introspect::quote_qualified(schema, table),
        set_fragments.join(", "),
        where_fragments.join(" AND ")
    );
    let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.clone()));
    for val in set_binds.into_iter().chain(where_binds) {
        query = bind_value(query, val)?;
    }
    query.execute(pool).await.map_err(|e| DbError::Query(e.to_string()))?;
    Ok(sql)
}

pub async fn delete_rows(
    pool: &MySqlPool,
    schema: &str,
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
            super::introspect::quote_qualified(schema, table),
            where_fragments.join(" AND ")
        );
        let mut query = sqlx::query(sqlx::AssertSqlSafe(sql.clone()));
        for val in where_binds {
            query = bind_value(query, val)?;
        }
        query.execute(&mut *tx).await.map_err(|e| DbError::Query(e.to_string()))?;
        executed.push(sql);
    }
    tx.commit().await.map_err(|e| DbError::Query(e.to_string()))?;
    Ok(executed)
}
