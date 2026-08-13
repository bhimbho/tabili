use std::sync::Arc;
use tauri::State;

use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{ColumnSpec, DatabaseDriver, DbError, TableDiff, TableRef};

async fn resolve(
    registry: &State<'_, ConnectionRegistry>,
    connection_id: &str,
) -> Result<Arc<dyn DatabaseDriver>, AppError> {
    registry
        .get(connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))
}

/// Returns the SQL that *would* run, without touching the database. The UI shows
/// this in a confirmation dialog; `execute_ddl` is a separate call so nothing
/// destructive can happen without the user seeing the statements first.
#[tauri::command]
#[specta::specta]
pub async fn preview_alter_table(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    table: String,
    diff: TableDiff,
) -> Result<Vec<String>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .build_alter_table_ddl(&TableRef { database: None, schema: None, table }, &diff)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn preview_add_column(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    table: String,
    column: ColumnSpec,
) -> Result<Vec<String>, AppError> {
    let diff = TableDiff {
        added_columns: vec![column],
        dropped_columns: vec![],
        renamed_columns: vec![],
    };
    preview_alter_table(registry, connection_id, table, diff).await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_drop_column(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    table: String,
    column: String,
) -> Result<Vec<String>, AppError> {
    let diff = TableDiff {
        added_columns: vec![],
        dropped_columns: vec![column],
        renamed_columns: vec![],
    };
    preview_alter_table(registry, connection_id, table, diff).await
}

#[tauri::command]
#[specta::specta]
pub async fn execute_ddl(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    statements: Vec<String>,
) -> Result<(), AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver.execute_ddl(&statements).await.map_err(AppError::from)
}
