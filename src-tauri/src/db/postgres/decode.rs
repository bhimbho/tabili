use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{DateTime, NaiveDate, NaiveDateTime, NaiveTime, Utc};
use rust_decimal::Decimal;
use sqlx::postgres::PgRow;
use sqlx::{Column, Row, TypeInfo, ValueRef};
use uuid::Uuid;

use crate::db::types::DbValue;

/// Reads the Postgres type name off the value itself and decodes accordingly.
/// Never panics — anything we don't explicitly handle (arrays, ranges, composites,
/// PostGIS geometry, etc.) degrades to `Unsupported` rather than crashing the fetch.
pub fn decode_value(row: &PgRow, idx: usize) -> DbValue {
    let raw = match row.try_get_raw(idx) {
        Ok(raw) => raw,
        Err(e) => {
            return DbValue::Unsupported {
                raw: e.to_string(),
                type_name: "unknown".to_string(),
            }
        }
    };

    if raw.is_null() {
        return DbValue::Null;
    }

    let type_name = raw.type_info().name().to_uppercase();
    match type_name.as_str() {
        "BOOL" => get_or_null(row, idx, DbValue::Bool),
        "INT2" | "INT4" => get_or_null::<i32, _>(row, idx, |v| DbValue::Int(v as i64)),
        "INT8" => get_or_null(row, idx, DbValue::Int),
        "FLOAT4" => get_or_null::<f32, _>(row, idx, |v| DbValue::Float(v as f64)),
        "FLOAT8" => get_or_null(row, idx, DbValue::Float),
        "NUMERIC" => get_or_null::<Decimal, _>(row, idx, |v| DbValue::Decimal(v.to_string())),
        "TEXT" | "VARCHAR" | "BPCHAR" | "NAME" | "CHAR" => get_or_null(row, idx, DbValue::Text),
        "BYTEA" => get_or_null::<Vec<u8>, _>(row, idx, |v| DbValue::Bytes(STANDARD.encode(v))),
        "JSON" | "JSONB" => get_or_null(row, idx, DbValue::Json),
        "TIMESTAMP" => {
            get_or_null::<NaiveDateTime, _>(row, idx, |v| DbValue::DateTime(v.to_string()))
        }
        "TIMESTAMPTZ" => get_or_null::<DateTime<Utc>, _>(row, idx, |v| DbValue::DateTime(v.to_rfc3339())),
        "DATE" => get_or_null::<NaiveDate, _>(row, idx, |v| DbValue::DateTime(v.to_string())),
        "TIME" => get_or_null::<NaiveTime, _>(row, idx, |v| DbValue::DateTime(v.to_string())),
        "UUID" => get_or_null::<Uuid, _>(row, idx, |v| DbValue::Uuid(v.to_string())),
        other => DbValue::Unsupported {
            raw: row
                .try_get::<String, _>(idx)
                .unwrap_or_else(|_| "<undecodable>".to_string()),
            type_name: other.to_string(),
        },
    }
}

fn get_or_null<'r, T, F>(row: &'r PgRow, idx: usize, f: F) -> DbValue
where
    T: sqlx::Decode<'r, sqlx::Postgres> + sqlx::Type<sqlx::Postgres>,
    F: FnOnce(T) -> DbValue,
{
    row.try_get::<T, _>(idx).map(f).unwrap_or(DbValue::Null)
}

pub fn column_names(row: &PgRow) -> Vec<String> {
    row.columns().iter().map(|c| c.name().to_string()).collect()
}
