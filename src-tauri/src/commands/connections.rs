use serde::{Deserialize, Serialize};
use specta::Type;
use std::sync::Arc;
use tauri::State;

use crate::app_store::{AppStore, SavedConnectionRecord};
use crate::connection_registry::ConnectionRegistry;
use crate::credentials;
use crate::db::error::AppError;
use crate::db::{connect_driver, ConnectionConfig, DatabaseInfo, DbError, DbKind, SqlDialect};
use crate::ssh_tunnel::{self, SshTunnelConfig};

#[derive(Debug, Clone, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct NewConnectionRequest {
    pub dialect: SqlDialect,
    pub name: String,
    pub color: Option<String>,
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
    pub ssh_enabled: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_username: Option<String>,
    pub ssh_password: Option<String>,
    pub ssh_use_key: bool,
    pub ssh_private_key_path: Option<String>,
    pub ssh_private_key_passphrase: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct OpenedConnection {
    pub connection_id: String,
    pub dialect: SqlDialect,
    pub display_name: String,
    pub color: Option<String>,
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

/// If SSH is enabled, opens a tunnel to `real_host:real_port` and rewrites
/// `config` to point at the tunnel's local forward instead. Returns the tunnel
/// so the caller can register it in the `ConnectionRegistry` — it must be kept
/// alive for as long as `config`'s driver connection is in use.
#[allow(clippy::too_many_arguments)]
async fn open_tunnel_if_needed(
    ssh_enabled: bool,
    ssh_host: Option<&str>,
    ssh_port: Option<u16>,
    ssh_username: Option<&str>,
    ssh_password: Option<String>,
    ssh_use_key: bool,
    ssh_private_key_path: Option<&str>,
    ssh_private_key_passphrase: Option<String>,
    config: &mut ConnectionConfig,
) -> Result<Option<Arc<ssh_tunnel::SshTunnel>>, AppError> {
    if !ssh_enabled {
        return Ok(None);
    }
    let ssh_config = SshTunnelConfig {
        host: ssh_host.unwrap_or_default().to_string(),
        port: ssh_port.unwrap_or(22),
        username: ssh_username.unwrap_or_default().to_string(),
        password: ssh_password,
        use_key: ssh_use_key,
        private_key_path: ssh_private_key_path.map(|s| s.to_string()),
        private_key_passphrase: ssh_private_key_passphrase,
    };
    let tunnel = ssh_tunnel::open_tunnel(&ssh_config, &config.host, config.port)
        .await
        .map_err(AppError::from)?;
    config.host = "127.0.0.1".to_string();
    config.port = tunnel.local_port;
    Ok(Some(Arc::new(tunnel)))
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
    let mut config = config_from_request(&request, request.password.clone());
    let tunnel = open_tunnel_if_needed(
        request.ssh_enabled,
        request.ssh_host.as_deref(),
        request.ssh_port,
        request.ssh_username.as_deref(),
        request.ssh_password.clone(),
        request.ssh_use_key,
        request.ssh_private_key_path.as_deref(),
        request.ssh_private_key_passphrase.clone(),
        &mut config,
    )
    .await?;

    let driver = match connect_driver(dialect_kind(request.dialect), &config).await {
        Ok(driver) => driver,
        Err(e) => {
            if let Some(tunnel) = &tunnel {
                tunnel.close().await;
            }
            return Err(AppError::from(e));
        }
    };

    let connection_id = uuid::Uuid::new_v4().to_string();

    app_store
        .upsert(&SavedConnectionRecord {
            id: connection_id.clone(),
            name: request.name.clone(),
            dialect: request.dialect,
            color: request.color.clone(),
            host: request.host.clone(),
            port: request.port,
            username: request.username.clone(),
            database: request.database.clone(),
            ssl_mode: request.ssl_mode.clone(),
            ssl_key_path: request.ssl_key_path.clone(),
            ssl_cert_path: request.ssl_cert_path.clone(),
            ssl_ca_path: request.ssl_ca_path.clone(),
            file_path: request.file_path.clone(),
            ssh_enabled: request.ssh_enabled,
            ssh_host: request.ssh_host.clone(),
            ssh_port: request.ssh_port,
            ssh_username: request.ssh_username.clone(),
            ssh_use_key: request.ssh_use_key,
            ssh_private_key_path: request.ssh_private_key_path.clone(),
        })
        .await
        .map_err(AppError::from)?;

    if let Some(password) = &request.password {
        credentials::save_password(&connection_id, password).map_err(AppError::from)?;
    }
    if let Some(ssh_password) = &request.ssh_password {
        credentials::save_ssh_password(&connection_id, ssh_password).map_err(AppError::from)?;
    }
    if let Some(passphrase) = &request.ssh_private_key_passphrase {
        credentials::save_ssh_key_passphrase(&connection_id, passphrase).map_err(AppError::from)?;
    }

    if let Some(tunnel) = tunnel {
        registry.insert_tunnel(connection_id.clone(), tunnel).await;
    }
    registry.insert(connection_id.clone(), driver).await;

    Ok(OpenedConnection {
        connection_id,
        dialect: request.dialect,
        display_name: request.name,
        color: request.color,
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
    let mut config = config_from_record(&record, password);

    let ssh_password = credentials::get_ssh_password(&id).map_err(AppError::from)?;
    let ssh_key_passphrase = credentials::get_ssh_key_passphrase(&id).map_err(AppError::from)?;
    let tunnel = open_tunnel_if_needed(
        record.ssh_enabled,
        record.ssh_host.as_deref(),
        record.ssh_port,
        record.ssh_username.as_deref(),
        ssh_password,
        record.ssh_use_key,
        record.ssh_private_key_path.as_deref(),
        ssh_key_passphrase,
        &mut config,
    )
    .await?;

    let driver = match connect_driver(dialect_kind(record.dialect), &config).await {
        Ok(driver) => driver,
        Err(e) => {
            if let Some(tunnel) = &tunnel {
                tunnel.close().await;
            }
            return Err(AppError::from(e));
        }
    };

    if let Some(tunnel) = tunnel {
        registry.insert_tunnel(id.clone(), tunnel).await;
    }
    registry.insert(id.clone(), driver).await;

    Ok(OpenedConnection {
        connection_id: id,
        dialect: record.dialect,
        display_name: record.name,
        color: record.color,
    })
}

#[tauri::command]
#[specta::specta]
pub async fn list_databases(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
) -> Result<Vec<DatabaseInfo>, AppError> {
    let driver = registry
        .get(&connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))?;
    driver.list_databases().await.map_err(AppError::from)
}

/// Postgres binds a connection to one database for its lifetime, so switching
/// means opening a fresh pool against the target and swapping it in under the
/// same connection id — tabs and saved metadata keep working unchanged. The
/// saved record is updated so the choice survives a restart.
#[tauri::command]
#[specta::specta]
pub async fn switch_database(
    registry: State<'_, ConnectionRegistry>,
    app_store: State<'_, AppStore>,
    connection_id: String,
    database: String,
) -> Result<(), AppError> {
    let mut record = app_store
        .get(&connection_id)
        .await
        .map_err(AppError::from)?
        .ok_or_else(|| AppError::from(DbError::Connection("saved connection not found".into())))?;

    if record.dialect == SqlDialect::Sqlite {
        return Err(AppError::from(DbError::Unsupported(
            "SQLite connections hold a single database file".into(),
        )));
    }

    let password = credentials::get_password(&connection_id).map_err(AppError::from)?;
    record.database = Some(database);
    let mut config = config_from_record(&record, password);

    // The SSH tunnel (if any) forwards to the same DB host/port regardless of
    // which database is selected, so the existing tunnel is reused rather than
    // opened again — only the pool behind it is replaced.
    if record.ssh_enabled {
        let tunnel = registry.get_tunnel(&connection_id).await.ok_or_else(|| {
            AppError::from(DbError::Connection("SSH tunnel is not open for this connection".into()))
        })?;
        config.host = "127.0.0.1".to_string();
        config.port = tunnel.local_port;
    }

    let driver = connect_driver(dialect_kind(record.dialect), &config)
        .await
        .map_err(AppError::from)?;

    // Only replace the live pool once the new one is known good.
    if let Some(old) = registry.remove(&connection_id).await {
        let _ = old.close().await;
    }
    registry.insert(connection_id.clone(), driver).await;
    app_store.upsert(&record).await.map_err(AppError::from)?;
    Ok(())
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
    registry.remove_tunnel(&id).await;
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
    registry.remove_tunnel(&connection_id).await;
    Ok(())
}
