use std::sync::Arc;
use tauri::State;

use std::time::Instant;

use crate::app_store::{AppStore, StatementLogEntry};
use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{ColumnSpec, DatabaseDriver, DbError, TableDiff, TableRef, TableSpec};

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
    schema: Option<String>,
    table: String,
    diff: TableDiff,
) -> Result<Vec<String>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .build_alter_table_ddl(&TableRef { database: None, schema, table }, &diff)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn preview_add_column(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    column: ColumnSpec,
) -> Result<Vec<String>, AppError> {
    let diff = TableDiff {
        added_columns: vec![column],
        dropped_columns: vec![],
        renamed_columns: vec![],
    };
    preview_alter_table(registry, connection_id, schema, table, diff).await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_drop_column(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    column: String,
) -> Result<Vec<String>, AppError> {
    let diff = TableDiff {
        added_columns: vec![],
        dropped_columns: vec![column],
        renamed_columns: vec![],
    };
    preview_alter_table(registry, connection_id, schema, table, diff).await
}

#[tauri::command]
#[specta::specta]
pub async fn preview_create_table(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    spec: TableSpec,
) -> Result<Vec<String>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver.build_create_table_ddl(&spec).await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn preview_drop_table(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<Vec<String>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .build_drop_table_ddl(&TableRef { database: None, schema, table })
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn preview_truncate_table(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<Vec<String>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .build_truncate_table_ddl(&TableRef { database: None, schema, table })
        .await
        .map_err(AppError::from)
}

/// `new_type` required for MySQL; `default` is `Some(Some("..."))` to set a
/// default, `Some(None)` to drop it, and `None` to leave it untouched.
#[tauri::command]
#[specta::specta]
pub async fn preview_edit_column(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    column: String,
    new_type: Option<String>,
    nullable: Option<bool>,
    new_default: Option<Option<String>>,
) -> Result<Vec<String>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .build_edit_column_ddl(
            &TableRef { database: None, schema, table },
            &column,
            new_type.as_deref(),
            nullable,
            new_default,
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn preview_create_index(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    index_name: String,
    unique: bool,
    columns: Vec<String>,
) -> Result<Vec<String>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .build_create_index_ddl(
            &TableRef { database: None, schema, table },
            &index_name,
            unique,
            &columns,
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn preview_drop_index(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    index_name: String,
) -> Result<Vec<String>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .build_drop_index_ddl(&TableRef { database: None, schema, table }, &index_name)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn execute_ddl(
    registry: State<'_, ConnectionRegistry>,
    app_store: State<'_, AppStore>,
    connection_id: String,
    statements: Vec<String>,
) -> Result<(), AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    let started = Instant::now();
    let result = driver.execute_ddl(&statements).await;
    let error = result.as_ref().err().map(|e| e.to_string());
    let duration_ms = started.elapsed().as_millis() as i64;
    for sql in &statements {
        let _ = app_store
            .log_statement(&StatementLogEntry {
                id: uuid::Uuid::new_v4().to_string(),
                connection_id: connection_id.clone(),
                sql: sql.clone(),
                success: error.is_none(),
                error: error.clone(),
                duration_ms,
                executed_at: String::new(),
            })
            .await;
    }
    result.map_err(AppError::from)
}
