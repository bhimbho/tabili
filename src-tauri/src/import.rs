use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;

use crate::db::error::DbError;
use crate::db::{DatabaseDriver, DbValue, TableRef};
use crate::sql::splitter::split_statements;

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CsvImportOptions {
    /// Treat the first row as column names. When false, values are matched to
    /// the table's columns positionally.
    pub first_row_is_header: bool,
    pub delimiter: String,
    /// Empty fields become NULL rather than an empty string. Usually what you
    /// want, since an empty string will not cast into a numeric or date column.
    pub empty_as_null: bool,
}

impl Default for CsvImportOptions {
    fn default() -> Self {
        Self {
            first_row_is_header: true,
            delimiter: ",".to_string(),
            empty_as_null: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    #[specta(type = specta_typescript::Number)]
    pub rows_imported: i64,
    #[specta(type = specta_typescript::Number)]
    pub statements_run: i64,
    /// Column names in the file that don't exist on the table; their values are
    /// skipped rather than failing the whole import.
    pub skipped_columns: Vec<String>,
}

/// Reads the header row (or the first data row's width) without consuming the
/// file, so the UI can show a column mapping before committing to an import.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CsvPreview {
    pub columns: Vec<String>,
    pub sample_rows: Vec<Vec<String>>,
}

fn io_err(e: impl std::fmt::Display) -> DbError {
    DbError::Other(format!("import failed: {e}"))
}

fn first_byte(s: &str, fallback: u8) -> u8 {
    s.as_bytes().first().copied().unwrap_or(fallback)
}

fn reader(path: &str, opts: &CsvImportOptions) -> Result<csv::Reader<std::fs::File>, DbError> {
    csv::ReaderBuilder::new()
        .delimiter(first_byte(&opts.delimiter, b','))
        .has_headers(opts.first_row_is_header)
        .flexible(true)
        .from_path(path)
        .map_err(io_err)
}

pub fn preview_csv(path: &str, opts: &CsvImportOptions) -> Result<CsvPreview, DbError> {
    let mut rdr = reader(path, opts)?;
    let columns: Vec<String> = if opts.first_row_is_header {
        rdr.headers()
            .map_err(io_err)?
            .iter()
            .map(|s| s.to_string())
            .collect()
    } else {
        Vec::new()
    };

    let mut sample_rows = Vec::new();
    for record in rdr.records().take(20) {
        let record = record.map_err(io_err)?;
        sample_rows.push(record.iter().map(|s| s.to_string()).collect());
    }
    Ok(CsvPreview { columns, sample_rows })
}

/// Imports a CSV file into an existing table, one INSERT per row.
///
/// Values are sent as text and left to the driver to coerce into the column's
/// declared type (Postgres casts explicitly, MySQL coerces, SQLite is
/// dynamically typed) — that keeps one code path instead of reimplementing
/// per-dialect literal parsing here.
pub async fn import_csv(
    driver: &dyn DatabaseDriver,
    schema: Option<String>,
    table: String,
    path: &str,
    opts: &CsvImportOptions,
) -> Result<ImportResult, DbError> {
    let table_ref = TableRef { database: None, schema, table };
    let table_columns: Vec<String> = driver
        .get_columns(&table_ref)
        .await?
        .into_iter()
        .map(|c| c.name)
        .collect();
    if table_columns.is_empty() {
        return Err(DbError::Other(format!(
            "table \"{}\" has no columns to import into",
            table_ref.table
        )));
    }

    let mut rdr = reader(path, opts)?;
    // Header names when present, otherwise the table's own column order.
    let file_columns: Vec<String> = if opts.first_row_is_header {
        rdr.headers()
            .map_err(io_err)?
            .iter()
            .map(|s| s.to_string())
            .collect()
    } else {
        table_columns.clone()
    };

    let skipped_columns: Vec<String> = file_columns
        .iter()
        .filter(|c| !table_columns.contains(c))
        .cloned()
        .collect();

    let mut rows_imported = 0i64;
    for (index, record) in rdr.records().enumerate() {
        let record = record.map_err(io_err)?;
        let mut values: HashMap<String, DbValue> = HashMap::new();
        for (i, raw) in record.iter().enumerate() {
            let Some(column) = file_columns.get(i) else { continue };
            if !table_columns.contains(column) {
                continue;
            }
            let value = if raw.is_empty() && opts.empty_as_null {
                DbValue::Null
            } else {
                DbValue::Text(raw.to_string())
            };
            values.insert(column.clone(), value);
        }
        if values.is_empty() {
            continue;
        }
        // The file's own line number (1-based, plus the header) so the message
        // points at something the user can actually find in their editor.
        let line = index + 1 + usize::from(opts.first_row_is_header);
        driver.insert_row(&table_ref, &values).await.map_err(|e| {
            DbError::Query(format!("row {line}: {e}"))
        })?;
        rows_imported += 1;
    }

    Ok(ImportResult {
        rows_imported,
        statements_run: rows_imported,
        skipped_columns,
    })
}

/// Runs a `.sql` dump. Statements execute in order via the driver's DDL path,
/// which already handles each dialect's transaction semantics.
pub async fn import_sql_dump(
    driver: &dyn DatabaseDriver,
    path: &str,
) -> Result<ImportResult, DbError> {
    let script = std::fs::read_to_string(path).map_err(io_err)?;
    let statements = split_statements(&script);
    if statements.is_empty() {
        return Err(DbError::Other("the file contains no SQL statements".into()));
    }
    let count = statements.len() as i64;
    driver.execute_ddl(&statements).await?;
    Ok(ImportResult {
        rows_imported: 0,
        statements_run: count,
        skipped_columns: Vec::new(),
    })
}
