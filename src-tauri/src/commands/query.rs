use std::time::Instant;
use tauri::State;

use crate::app_store::{AppStore, StatementLogEntry};
use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{DbError, QueryExecutionId, QueryHandle, RowPage};

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
