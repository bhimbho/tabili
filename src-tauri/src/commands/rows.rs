use std::collections::HashMap;
use tauri::State;

use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{DbError, DbValue, FetchOptions, RowPage, TableRef};

async fn resolve(
    registry: &State<'_, ConnectionRegistry>,
    connection_id: &str,
) -> Result<std::sync::Arc<dyn crate::db::DatabaseDriver>, AppError> {
    registry
        .get(connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))
}

#[tauri::command]
#[specta::specta]
pub async fn fetch_rows(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    table: String,
    limit: u32,
    offset: u32,
) -> Result<RowPage, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .fetch_rows(
            &TableRef { database: None, schema: None, table },
            FetchOptions { limit, offset, order_by: None },
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn insert_row(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    table: String,
    values: HashMap<String, DbValue>,
) -> Result<(), AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .insert_row(&TableRef { database: None, schema: None, table }, &values)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn update_row(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    table: String,
    pk: HashMap<String, DbValue>,
    changes: HashMap<String, DbValue>,
) -> Result<(), AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .update_row(&TableRef { database: None, schema: None, table }, &pk, &changes)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_rows(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    table: String,
    pks: Vec<HashMap<String, DbValue>>,
) -> Result<(), AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .delete_rows(&TableRef { database: None, schema: None, table }, &pks)
        .await
        .map_err(AppError::from)
}
