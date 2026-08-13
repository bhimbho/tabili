use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum SqlDialect {
    Postgres,
    MySql,
    Sqlite,
}

/// Dynamic decode target for a single cell value. Every driver's `decode.rs` must map
/// into this without panicking — unrecognized/exotic column types fall back to
/// `Unsupported` rather than crashing the row fetch.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Type)]
#[serde(tag = "type", content = "value")]
pub enum DbValue {
    Null,
    Bool(bool),
    /// Exported as TS `number`: JSON-wire-compatible with i64, precision loss above
    /// 2^53 is an accepted display-only limitation (matches how most DB GUIs handle it).
    Int(#[specta(type = specta_typescript::Number)] i64),
    Float(f64),
    /// Stringified to avoid precision loss through f64.
    Decimal(String),
    Text(String),
    /// Base64-encoded over IPC.
    Bytes(String),
    Json(#[specta(type = specta_typescript::Any)] serde_json::Value),
    /// ISO-8601; formatting/timezone display is a frontend concern.
    DateTime(String),
    Uuid(String),
    Array(Vec<DbValue>),
    #[serde(rename_all = "camelCase")]
    Unsupported { raw: String, type_name: String },
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct DatabaseInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SchemaInfo {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct SchemaRef {
    pub database: Option<String>,
    pub schema: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct TableRef {
    pub database: Option<String>,
    pub schema: Option<String>,
    pub table: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TableInfo {
    pub name: String,
    pub is_view: bool,
    #[specta(type = specta_typescript::Number)]
    pub estimated_row_count: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnInfo {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub is_primary_key: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct IndexInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub is_unique: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct ConstraintInfo {
    pub name: String,
    pub kind: String,
    pub columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ForeignKeyInfo {
    pub name: String,
    pub columns: Vec<String>,
    pub referenced_table: String,
    pub referenced_columns: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FetchOptions {
    pub limit: u32,
    pub offset: u32,
    pub order_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RowPage {
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, DbValue>>,
    pub has_more: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct QueryExecutionId(pub String);

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct QueryHandle {
    pub execution_id: QueryExecutionId,
    pub first_page: RowPage,
}

/// A structural diff between the current and desired shape of a table, used to
/// build per-dialect ALTER TABLE statement sequences.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TableDiff {
    pub added_columns: Vec<ColumnSpec>,
    pub dropped_columns: Vec<String>,
    pub renamed_columns: Vec<(String, String)>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnSpec {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub default_value: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TableSpec {
    pub name: String,
    pub columns: Vec<ColumnSpec>,
    pub primary_key: Vec<String>,
}
