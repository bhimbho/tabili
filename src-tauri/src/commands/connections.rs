use serde::{Deserialize, Serialize};
use specta::Type;
use tauri::State;

use crate::app_store::{AppStore, SavedConnectionRecord};
use crate::connection_registry::ConnectionRegistry;
use crate::credentials;
use crate::db::error::AppError;
use crate::db::{connect_driver, ConnectionConfig, DbError, DbKind, SqlDialect};

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewConnectionRequest {
    pub dialect: SqlDialect,
    pub name: String,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub database: Option<String>,
    pub ssl_mode: Option<String>,
    pub ssl_key_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_ca_path: Option<String>,
    /// SQLite only.
    pub file_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenedConnection {
    pub connection_id: String,
    pub dialect: SqlDialect,
    pub display_name: String,
}

fn config_from_request(request: &NewConnectionRequest, password: Option<String>) -> ConnectionConfig {
    ConnectionConfig {
        host: request.host.clone().unwrap_or_default(),
        port: request.port.unwrap_or_default(),
        username: request.username.clone().unwrap_or_default(),
        password,
        database: request.database.clone(),
        ssl_mode: request.ssl_mode.clone(),
        ssl_key_path: request.ssl_key_path.clone(),
        ssl_cert_path: request.ssl_cert_path.clone(),
        ssl_ca_path: request.ssl_ca_path.clone(),
        file_path: request.file_path.clone(),
        max_connections: 5,
    }
}

fn config_from_record(record: &SavedConnectionRecord, password: Option<String>) -> ConnectionConfig {
    ConnectionConfig {
        host: record.host.clone().unwrap_or_default(),
        port: record.port.unwrap_or_default(),
        username: record.username.clone().unwrap_or_default(),
        password,
        database: record.database.clone(),
        ssl_mode: record.ssl_mode.clone(),
        ssl_key_path: record.ssl_key_path.clone(),
        ssl_cert_path: record.ssl_cert_path.clone(),
        ssl_ca_path: record.ssl_ca_path.clone(),
        file_path: record.file_path.clone(),
        max_connections: 5,
    }
}

fn dialect_kind(dialect: SqlDialect) -> DbKind {
    match dialect {
        SqlDialect::Postgres => DbKind::Postgres,
        SqlDialect::MySql => DbKind::MySql,
        SqlDialect::Sqlite => DbKind::Sqlite,
    }
}

/// Handles all three dialects. Postgres/MySQL genuinely attempt to connect (the
/// pool/auth logic is real); their introspection and query commands still return
/// "not yet implemented" until M2 fills in the driver bodies. On success the
/// connection is persisted (metadata to the local app store, password to the
/// OS keychain) so it survives an app restart.
#[tauri::command]
#[specta::specta]
pub async fn open_connection(
    registry: State<'_, ConnectionRegistry>,
    app_store: State<'_, AppStore>,
    request: NewConnectionRequest,
) -> Result<OpenedConnection, AppError> {
    let config = config_from_request(&request, request.password.clone());
    let driver = connect_driver(dialect_kind(request.dialect), &config)
        .await
        .map_err(AppError::from)?;

    let connection_id = uuid::Uuid::new_v4().to_string();

    app_store
        .upsert(&SavedConnectionRecord {
            id: connection_id.clone(),
            name: request.name.clone(),
            dialect: request.dialect,
            host: request.host.clone(),
            port: request.port,
            username: request.username.clone(),
            database: request.database.clone(),
            ssl_mode: request.ssl_mode.clone(),
            ssl_key_path: request.ssl_key_path.clone(),
            ssl_cert_path: request.ssl_cert_path.clone(),
            ssl_ca_path: request.ssl_ca_path.clone(),
            file_path: request.file_path.clone(),
        })
        .await
        .map_err(AppError::from)?;

    if let Some(password) = &request.password {
        credentials::save_password(&connection_id, password).map_err(AppError::from)?;
    }

    registry.insert(connection_id.clone(), driver).await;

    Ok(OpenedConnection {
        connection_id,
        dialect: request.dialect,
        display_name: request.name,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_saved_connections(
    app_store: State<'_, AppStore>,
) -> Result<Vec<SavedConnectionRecord>, AppError> {
    app_store.list().await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn connect_saved(
    registry: State<'_, ConnectionRegistry>,
    app_store: State<'_, AppStore>,
    id: String,
) -> Result<OpenedConnection, AppError> {
    let record = app_store
        .get(&id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::from(DbError::Connection("saved connection not found".into())))?;

    let password = credentials::get_password(&id).map_err(AppError::from)?;
    let config = config_from_record(&record, password);
    let driver = connect_driver(dialect_kind(record.dialect), &config)
        .await
        .map_err(AppError::from)?;

    registry.insert(id.clone(), driver).await;

    Ok(OpenedConnection {
        connection_id: id,
        dialect: record.dialect,
        display_name: record.name,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn delete_saved_connection(
    registry: State<'_, ConnectionRegistry>,
    app_store: State<'_, AppStore>,
    id: String,
) -> Result<(), AppError> {
    if let Some(driver) = registry.remove(&id).await {
        driver.close().await.map_err(AppError::from)?;
    }
    app_store.delete(&id).await.map_err(AppError::from)?;
    credentials::delete_password(&id).map_err(AppError::from)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn close_connection(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
) -> Result<(), AppError> {
    if let Some(driver) = registry.remove(&connection_id).await {
        driver.close().await.map_err(AppError::from)?;
    }
    Ok(())
}
