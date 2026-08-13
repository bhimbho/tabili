use std::sync::Arc;
use tauri::State;

use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{
    ColumnInfo, DatabaseDriver, DbError, ForeignKeyInfo, IndexInfo, SchemaRef, TableInfo, TableRef,
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

fn table_ref(table: String) -> TableRef {
    TableRef { database: None, schema: None, table }
}

#[tauri::command]
#[specta::specta]
pub async fn list_tables(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
) -> Result<Vec<TableInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .list_tables(&SchemaRef { database: None, schema: None })
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn list_views(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
) -> Result<Vec<TableInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .list_views(&SchemaRef { database: None, schema: None })
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_columns(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    table: String,
) -> Result<Vec<ColumnInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver.get_columns(&table_ref(table)).await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_indexes(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    table: String,
) -> Result<Vec<IndexInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver.get_indexes(&table_ref(table)).await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_foreign_keys(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    table: String,
) -> Result<Vec<ForeignKeyInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .get_foreign_keys(&table_ref(table))
        .await
        .map_err(AppError::from)
}
