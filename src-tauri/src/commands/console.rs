use tauri::State;

use crate::app_store::{AppStore, SavedQuery, StatementLogEntry};
use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{DbError, ServerInfo};

#[tauri::command]
#[specta::specta]
pub async fn server_info(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
) -> Result<ServerInfo, AppError> {
    let driver = registry
        .get(&connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))?;
    driver.server_info().await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn list_statement_log(
    app_store: State<'_, AppStore>,
    limit: u32,
) -> Result<Vec<StatementLogEntry>, AppError> {
    app_store.list_statement_log(limit).await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn clear_statement_log(app_store: State<'_, AppStore>) -> Result<(), AppError> {
    app_store.clear_statement_log().await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn list_saved_queries(app_store: State<'_, AppStore>) -> Result<Vec<SavedQuery>, AppError> {
    app_store.list_saved_queries().await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn save_query(
    app_store: State<'_, AppStore>,
    name: String,
    sql: String,
) -> Result<SavedQuery, AppError> {
    let query = SavedQuery {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        sql,
        created_at: String::new(),
    };
    app_store.save_query(&query).await.map_err(AppError::from)?;
    Ok(query)
}

#[tauri::command]
#[specta::specta]
pub async fn delete_saved_query(app_store: State<'_, AppStore>, id: String) -> Result<(), AppError> {
    app_store.delete_saved_query(&id).await.map_err(AppError::from)
}
