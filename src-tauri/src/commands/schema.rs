use std::sync::Arc;
use tauri::State;

use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{
    ColumnInfo, DatabaseDriver, DbError, ForeignKeyInfo, IndexInfo, SchemaInfo, SchemaRef,
    TableInfo, TableRef, TriggerInfo, FunctionInfo,
};

async fn resolve(
    registry: &State<'_, ConnectionRegistry>,
    connection_id: &str,
) -> Result<Arc<dyn DatabaseDriver>, AppError> {
    registry
        .get(connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))
}

/// `schema` is None for SQLite (which has no schemas) and for callers that want
/// the driver's default (`public` on Postgres).
fn table_ref(schema: Option<String>, table: String) -> TableRef {
    TableRef { database: None, schema, table }
}

#[tauri::command]
#[specta::specta]
pub async fn list_schemas(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
) -> Result<Vec<SchemaInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver.list_schemas(None).await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn list_tables(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .list_tables(&SchemaRef { database: None, schema })
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn list_views(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .list_views(&SchemaRef { database: None, schema })
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn list_functions(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<FunctionInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .list_functions(&SchemaRef { database: None, schema })
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_columns(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<Vec<ColumnInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .get_columns(&table_ref(schema, table))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_indexes(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<Vec<IndexInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .get_indexes(&table_ref(schema, table))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_foreign_keys(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<Vec<ForeignKeyInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .get_foreign_keys(&table_ref(schema, table))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_triggers(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<Vec<TriggerInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .get_triggers(&table_ref(schema, table))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_table_ddl(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<String, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .get_table_ddl(&table_ref(schema, table))
        .await
        .map_err(AppError::from)
}
