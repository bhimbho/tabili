use base64::{engine::general_purpose::STANDARD, Engine as _};
use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use rust_decimal::Decimal;
use sqlx::mysql::MySqlRow;
use sqlx::{Column, Row, TypeInfo, ValueRef};

use crate::db::types::DbValue;

/// MySQL reports integer columns as one of several widths (TINYINT..BIGINT, each
/// signed or unsigned), and sqlx's Decode is exact-width — `try_get::<i64,_>` on a
/// TINYINT column fails outright. Rather than branch on every width, this tries
/// them widest-signed-first and falls through, which is the direction MySQL
/// itself widens integers in expressions.
fn decode_int(row: &MySqlRow, idx: usize) -> DbValue {
    if let Ok(v) = row.try_get::<i64, _>(idx) {
        return DbValue::Int(v);
    }
    if let Ok(v) = row.try_get::<u64, _>(idx) {
        // BIGINT UNSIGNED can exceed i64::MAX; DbValue::Int is i64, so this is a
        // known display-precision edge case shared with the general Int variant.
        return DbValue::Int(v as i64);
    }
    if let Ok(v) = row.try_get::<i32, _>(idx) {
        return DbValue::Int(v as i64);
    }
    if let Ok(v) = row.try_get::<u32, _>(idx) {
        return DbValue::Int(v as i64);
    }
    DbValue::Null
}

/// Reads the MySQL type name off the value itself and decodes accordingly. Never
/// panics — anything not explicitly handled degrades to `Unsupported` rather than
/// failing the whole row fetch.
pub fn decode_value(row: &MySqlRow, idx: usize) -> DbValue {
    let raw = match row.try_get_raw(idx) {
        Ok(raw) => raw,
        Err(e) => {
            return DbValue::Unsupported { raw: e.to_string(), type_name: "unknown".to_string() }
        }
    };
    if raw.is_null() {
        return DbValue::Null;
    }

    match raw.type_info().name().to_uppercase().as_str() {
        "TINYINT" | "SMALLINT" | "MEDIUMINT" | "INT" | "INTEGER" | "BIGINT" | "YEAR" => {
            decode_int(row, idx)
        }
        "BOOLEAN" | "BOOL" => row.try_get::<bool, _>(idx).map(DbValue::Bool).unwrap_or(DbValue::Null),
        "FLOAT" => row.try_get::<f32, _>(idx).map(|v| DbValue::Float(v as f64)).unwrap_or(DbValue::Null),
        "DOUBLE" => row.try_get::<f64, _>(idx).map(DbValue::Float).unwrap_or(DbValue::Null),
        "DECIMAL" | "NEWDECIMAL" => row
            .try_get::<Decimal, _>(idx)
            .map(|v| DbValue::Decimal(v.to_string()))
            .unwrap_or(DbValue::Null),
        "VARCHAR" | "CHAR" | "TEXT" | "TINYTEXT" | "MEDIUMTEXT" | "LONGTEXT" | "ENUM" | "SET" => {
            row.try_get::<String, _>(idx).map(DbValue::Text).unwrap_or(DbValue::Null)
        }
        "BLOB" | "TINYBLOB" | "MEDIUMBLOB" | "LONGBLOB" | "BINARY" | "VARBINARY" => row
            .try_get::<Vec<u8>, _>(idx)
            .map(|v| DbValue::Bytes(STANDARD.encode(v)))
            .unwrap_or(DbValue::Null),
        "JSON" => row.try_get(idx).map(DbValue::Json).unwrap_or(DbValue::Null),
        "DATE" => row
            .try_get::<NaiveDate, _>(idx)
            .map(|v| DbValue::DateTime(v.to_string()))
            .unwrap_or(DbValue::Null),
        "TIME" => row
            .try_get::<NaiveTime, _>(idx)
            .map(|v| DbValue::DateTime(v.to_string()))
            .unwrap_or(DbValue::Null),
        "DATETIME" | "TIMESTAMP" => row
            .try_get::<NaiveDateTime, _>(idx)
            .map(|v| DbValue::DateTime(v.to_string()))
            .unwrap_or(DbValue::Null),
        other => match row.try_get::<String, _>(idx) {
            Ok(text) => DbValue::Text(text),
            Err(_) => DbValue::Unsupported { raw: "<undecodable>".to_string(), type_name: other.to_string() },
        },
    }
}

pub fn column_names(row: &MySqlRow) -> Vec<String> {
    row.columns().iter().map(|c| c.name().to_string()).collect()
}
