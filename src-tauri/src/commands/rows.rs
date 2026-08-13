use std::collections::HashMap;
use tauri::State;

use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{ColumnFilter, DbError, DbValue, FetchOptions, RowPage, TableRef};

async fn resolve(
    registry: &State<'_, ConnectionRegistry>,
    connection_id: &str,
) -> Result<std::sync::Arc<dyn crate::db::DatabaseDriver>, AppError> {
    registry
        .get(connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))
}

fn table_ref(schema: Option<String>, table: String) -> TableRef {
    TableRef { database: None, schema, table }
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn fetch_rows(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    limit: u32,
    offset: u32,
    order_by: Option<String>,
    order_desc: bool,
    filters: Vec<ColumnFilter>,
) -> Result<RowPage, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .fetch_rows(
            &table_ref(schema, table),
            FetchOptions { limit, offset, order_by, order_desc, filters },
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn insert_row(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    values: HashMap<String, DbValue>,
) -> Result<(), AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .insert_row(&table_ref(schema, table), &values)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn update_row(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    pk: HashMap<String, DbValue>,
    changes: HashMap<String, DbValue>,
) -> Result<(), AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .update_row(&table_ref(schema, table), &pk, &changes)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_rows(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    pks: Vec<HashMap<String, DbValue>>,
) -> Result<(), AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .delete_rows(&table_ref(schema, table), &pks)
        .await
        .map_err(AppError::from)
}
