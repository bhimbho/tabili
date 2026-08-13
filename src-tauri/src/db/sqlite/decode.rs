use base64::{engine::general_purpose::STANDARD, Engine as _};
use sqlx::sqlite::SqliteRow;
use sqlx::{Column, Row, TypeInfo, ValueRef};

use crate::db::types::DbValue;

/// SQLite storage classes are dynamic per-value (not per-column), so the actual
/// type is read off the value itself rather than the declared column type.
/// Never panics — anything unrecognized degrades to `Unsupported`.
pub fn decode_value(row: &SqliteRow, idx: usize) -> DbValue {
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

    match raw.type_info().name() {
        "INTEGER" | "BOOLEAN" => row
            .try_get::<i64, _>(idx)
            .map(DbValue::Int)
            .unwrap_or(DbValue::Null),
        "REAL" => row
            .try_get::<f64, _>(idx)
            .map(DbValue::Float)
            .unwrap_or(DbValue::Null),
        "TEXT" => row
            .try_get::<String, _>(idx)
            .map(DbValue::Text)
            .unwrap_or(DbValue::Null),
        "BLOB" => row
            .try_get::<Vec<u8>, _>(idx)
            .map(|bytes| DbValue::Bytes(STANDARD.encode(bytes)))
            .unwrap_or(DbValue::Null),
        other => DbValue::Unsupported {
            raw: row
                .try_get::<String, _>(idx)
                .unwrap_or_else(|_| "<undecodable>".to_string()),
            type_name: other.to_string(),
        },
    }
}

pub fn column_names(row: &SqliteRow) -> Vec<String> {
    row.columns().iter().map(|c| c.name().to_string()).collect()
}
