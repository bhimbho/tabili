use serde::Deserialize;
use specta::Type;
use tauri::State;

use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{DbError, DbGrant, DbUser};

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct UserPayload {
    pub name: String,
    pub password: Option<String>,
    pub host: Option<String>,
    pub superuser: Option<bool>,
}

#[tauri::command]
#[specta::specta]
pub async fn list_users(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
) -> Result<Vec<DbUser>, AppError> {
    let driver = registry
        .get(&connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))?;
    driver.list_users().await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn create_user(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    payload: UserPayload,
) -> Result<(), AppError> {
    let driver = registry
        .get(&connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))?;
    driver
        .create_user(
            &payload.name,
            payload.password.as_deref().unwrap_or(""),
            payload.host.as_deref(),
            payload.superuser.unwrap_or(false),
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn drop_user(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    name: String,
    host: Option<String>,
) -> Result<(), AppError> {
    let driver = registry
        .get(&connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))?;
    driver.drop_user(&name, host.as_deref()).await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn alter_user_password(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    name: String,
    host: Option<String>,
    new_password: String,
) -> Result<(), AppError> {
    let driver = registry
        .get(&connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))?;
    driver
        .alter_user_password(&name, host.as_deref(), &new_password)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn user_grants(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    name: String,
    host: Option<String>,
) -> Result<Vec<DbGrant>, AppError> {
    let driver = registry
        .get(&connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))?;
    driver.user_grants(&name, host.as_deref()).await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn grant_privilege(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    name: String,
    host: Option<String>,
    privilege: String,
    schema: Option<String>,
    table: Option<String>,
) -> Result<(), AppError> {
    let driver = registry
        .get(&connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))?;
    driver
        .grant_privilege(
            &name,
            host.as_deref(),
            &privilege,
            schema.as_deref(),
            table.as_deref(),
        )
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn revoke_privilege(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    name: String,
    host: Option<String>,
    privilege: String,
    schema: Option<String>,
    table: Option<String>,
) -> Result<(), AppError> {
    let driver = registry
        .get(&connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))?;
    driver
        .revoke_privilege(
            &name,
            host.as_deref(),
            &privilege,
            schema.as_deref(),
            table.as_deref(),
        )
        .await
        .map_err(AppError::from)
}
