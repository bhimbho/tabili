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
    /// "Use the column's declared default". Write-only — decoding never produces
    /// it — and inlined as the SQL keyword `DEFAULT` rather than bound, the same
    /// way `Null` is. SQLite has no `SET col = DEFAULT`, so its driver rejects it.
    Default,
    /// "Whatever the server's clock says at write time". Also write-only, and
    /// inlined as `CURRENT_TIMESTAMP` — the spelling every dialect here accepts,
    /// unlike `NOW()`, which SQLite lacks.
    Now,
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

impl DbValue {
    /// Values that go into a statement as a bare SQL keyword instead of a bound
    /// parameter. Keeping this in one place stops the three drivers drifting on
    /// which variants are inlined.
    pub fn inline_keyword(&self) -> Option<&'static str> {
        match self {
            DbValue::Null => Some("NULL"),
            DbValue::Default => Some("DEFAULT"),
            DbValue::Now => Some("CURRENT_TIMESTAMP"),
            _ => None,
        }
    }
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
    /// Allowed labels when the column's type is an enumeration, in declaration
    /// order. Empty for every other type, which is how the UI decides whether to
    /// offer a picker instead of a free-text field.
    pub enum_values: Vec<String>,
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
pub struct ServerInfo {
    pub version: String,
    pub database: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FunctionInfo {
    pub name: String,
    /// Rendered argument list, e.g. "uid integer, since timestamptz".
    pub arguments: String,
    pub returns: String,
    /// "function" or "procedure".
    pub kind: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct TriggerInfo {
    pub name: String,
    pub timing: String,
    pub event: String,
    pub statement: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum FilterOperator {
    Equals,
    NotEquals,
    Contains,
    StartsWith,
    EndsWith,
    GreaterThan,
    LessThan,
    GreaterOrEqual,
    LessOrEqual,
    IsNull,
    IsNotNull,
}

impl FilterOperator {
    /// IS NULL / IS NOT NULL are the only operators that take no operand.
    pub fn takes_value(self) -> bool {
        !matches!(self, FilterOperator::IsNull | FilterOperator::IsNotNull)
    }

    /// Text-pattern operators always compare as text, so the column gets cast.
    pub fn is_pattern(self) -> bool {
        matches!(
            self,
            FilterOperator::Contains | FilterOperator::StartsWith | FilterOperator::EndsWith
        )
    }

    pub fn wrap_pattern(self, raw: &str) -> String {
        match self {
            FilterOperator::Contains => format!("%{raw}%"),
            FilterOperator::StartsWith => format!("{raw}%"),
            FilterOperator::EndsWith => format!("%{raw}"),
            _ => raw.to_string(),
        }
    }

    pub fn sql_symbol(self) -> &'static str {
        match self {
            FilterOperator::Equals => "=",
            FilterOperator::NotEquals => "<>",
            FilterOperator::GreaterThan => ">",
            FilterOperator::LessThan => "<",
            FilterOperator::GreaterOrEqual => ">=",
            FilterOperator::LessOrEqual => "<=",
            FilterOperator::Contains | FilterOperator::StartsWith | FilterOperator::EndsWith => {
                "LIKE"
            }
            FilterOperator::IsNull => "IS NULL",
            FilterOperator::IsNotNull => "IS NOT NULL",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ColumnFilter {
    pub column: String,
    pub operator: FilterOperator,
    /// Typed by the frontend from the column's declared type so it binds as the
    /// right SQL type; ignored for IS NULL / IS NOT NULL.
    pub value: Option<DbValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FetchOptions {
    pub limit: u32,
    pub offset: u32,
    pub order_by: Option<String>,
    pub order_desc: bool,
    pub filters: Vec<ColumnFilter>,
}

impl FetchOptions {
    pub fn page(limit: u32, offset: u32) -> Self {
        Self { limit, offset, order_by: None, order_desc: false, filters: Vec::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RowPage {
    pub columns: Vec<String>,
    pub rows: Vec<HashMap<String, DbValue>>,
    pub has_more: bool,
    /// The statement actually sent to the server, surfaced in the console so the
    /// UI never has to guess what it ran.
    pub sql: String,
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

// --- User management ---

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DbUser {
    pub name: String,
    pub host: Option<String>,
    pub superuser: bool,
    pub can_create_db: bool,
    pub can_create_role: bool,
    pub can_login: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DbGrant {
    pub privilege: String,
    pub schema: Option<String>,
    pub table: Option<String>,
}
