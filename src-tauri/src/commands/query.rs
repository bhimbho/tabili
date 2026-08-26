use std::time::Instant;
use tauri::State;

use crate::app_store::{AppStore, StatementLogEntry};
use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{DbError, QueryExecutionId, QueryHandle, RowPage, SqlDialect};
use crate::export::{quote_ident, sql_literal};

async fn resolve(
    registry: &State<'_, ConnectionRegistry>,
    connection_id: &str,
) -> Result<std::sync::Arc<dyn crate::db::DatabaseDriver>, AppError> {
    registry
        .get(connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))
}

async fn log(
    store: &State<'_, AppStore>,
    connection_id: &str,
    sql: &str,
    started: Instant,
    error: Option<&str>,
) {
    let duration_ms = started.elapsed().as_millis() as i64;
    let entry = StatementLogEntry {
        id: uuid::Uuid::new_v4().to_string(),
        connection_id: connection_id.to_string(),
        sql: sql.to_string(),
        success: error.is_none(),
        error: error.map(|e| e.to_string()),
        duration_ms,
        executed_at: String::new(),
    };
    let _ = store.log_statement(&entry).await;
}

#[tauri::command]
#[specta::specta]
pub async fn run_query(
    registry: State<'_, ConnectionRegistry>,
    app_store: State<'_, AppStore>,
    connection_id: String,
    sql: String,
) -> Result<QueryHandle, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    let started = Instant::now();
    let result = driver.run_query(&sql).await;

    match result {
        Ok(handle) => {
            log(&app_store, &connection_id, &sql, started, None).await;
            Ok(handle)
        }
        Err(e) => {
            let msg = e.to_string();
            log(&app_store, &connection_id, &sql, started, Some(&msg)).await;
            Err(AppError::from(e))
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_more(
    registry: State<'_, ConnectionRegistry>,
    _app_store: State<'_, AppStore>,
    connection_id: String,
    execution_id: String,
    n: u32,
) -> Result<RowPage, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    let handle = QueryExecutionId(execution_id);
    driver.fetch_more(&handle, n).await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn cancel_query(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    execution_id: String,
) -> Result<(), AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    let handle = QueryExecutionId(execution_id);
    driver.cancel(&handle).await.map_err(AppError::from)
}

/// Splits a SQL script into individual statements, reusing the same logic that
/// powers SQL-dump imports so the editor's "Run current" / "Run all" agree with
/// what the importer would execute.
#[tauri::command]
#[specta::specta]
pub fn split_sql(script: String) -> Vec<String> {
    crate::sql::splitter::split_statements(&script)
}

/// Writes a text payload to a file the user picked via the save dialog. Used to
/// persist a query as JSON (or any text) without pulling in a filesystem plugin.
#[tauri::command]
#[specta::specta]
pub fn save_sql_file(path: String, contents: String) -> Result<(), AppError> {
    std::fs::write(&path, contents).map_err(|e| {
        AppError::from(DbError::Other(format!("failed to write file: {e}")))
    })
}

/// Writes query-result rows to a file as CSV, JSON, or SQL INSERT statements.
/// The frontend already holds the materialised rows from `run_query`/`fetch_more`,
/// so this just serialises them — no database round-trip needed.
#[tauri::command]
#[specta::specta]
pub fn export_query_result(
    path: String,
    columns: Vec<String>,
    rows: Vec<std::collections::HashMap<String, crate::db::DbValue>>,
    format: String,
    dialect: String,
    include_data: Option<bool>,
) -> Result<(), AppError> {
    use crate::db::DbValue;

    let sql_dialect = match dialect.as_str() {
        "MySql" => SqlDialect::MySql,
        _ => SqlDialect::Postgres,
    };

    let content = match format.as_str() {
        "json" => serde_json::to_string_pretty(&rows)
            .map_err(|e| DbError::Other(format!("failed to serialise rows: {e}")))?,
        "sql" => {
            let include = include_data.unwrap_or(true);
            let target = "query_result";
            let target_quoted = quote_ident(target, sql_dialect);
            let column_list = columns
                .iter()
                .map(|c| quote_ident(c, sql_dialect))
                .collect::<Vec<_>>()
                .join(", ");
            let mut out = String::new();
            if !include {
                // Schema-only stub for query results: just emit a comment
                out.push_str(&format!("-- SELECT statement results for {}\n", target_quoted));
                out.push_str("-- (Schema-only export is not applicable for query results)\n");
            }
            for row in &rows {
                let values = columns
                    .iter()
                    .map(|c| sql_literal(row.get(c).unwrap_or(&DbValue::Null)))
                    .collect::<Vec<_>>()
                    .join(", ");
                out.push_str(&format!(
                    "INSERT INTO {target_quoted} ({column_list}) VALUES ({values});\n"
                ));
            }
            out
        }
        _ => {
            let mut writer = csv::Writer::from_writer(Vec::new());
            writer
                .write_record(&columns)
                .map_err(|e| DbError::Other(format!("failed to write csv: {e}")))?;
            for row in &rows {
                let record: Vec<String> = columns
                    .iter()
                    .map(|c| match row.get(c) {
                        Some(DbValue::Null) => String::new(),
                        Some(DbValue::Default) => "DEFAULT".to_string(),
                        Some(DbValue::Now) => "CURRENT_TIMESTAMP".to_string(),
                        Some(DbValue::Bool(b)) => b.to_string(),
                        Some(DbValue::Int(i)) => i.to_string(),
                        Some(DbValue::Float(f)) => f.to_string(),
                        Some(DbValue::Decimal(s)) => s.clone(),
                        Some(DbValue::Text(s))
                        | Some(DbValue::DateTime(s))
                        | Some(DbValue::Uuid(s))
                        | Some(DbValue::Bytes(s)) => s.clone(),
                        Some(DbValue::Json(v)) => v.to_string(),
                        Some(DbValue::Array(items)) => {
                            serde_json::to_string(items).unwrap_or_else(|_| "[]".to_string())
                        }
                        Some(DbValue::Unsupported { raw, .. }) => raw.clone(),
                        None => String::new(),
                    })
                    .collect();
                writer
                    .write_record(&record)
                    .map_err(|e| DbError::Other(format!("failed to write csv: {e}")))?;
            }
            let bytes = writer
                .into_inner()
                .map_err(|e| DbError::Other(format!("failed to finalise csv: {e}")))?;
            String::from_utf8(bytes).map_err(|e| DbError::Other(e.to_string()))?
        }
    };
    std::fs::write(&path, content).map_err(|e| {
        AppError::from(DbError::Other(format!("failed to write file: {e}")))
    })
}
