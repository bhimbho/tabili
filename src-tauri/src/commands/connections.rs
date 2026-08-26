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

/// Treats an empty string as "not set".
///
/// A field the user never filled in can reach us as `""` rather than `None` —
/// from the form, or from a saved row that stored an empty string. Passing that
/// through is not harmless: sqlx reads a certificate path eagerly, so
/// `Some("")` makes it open a file named `""` and fail with a bare
/// "no such file or directory" that says nothing about which setting caused it.
fn present(value: &Option<String>) -> Option<String> {
    value.as_ref().filter(|s| !s.trim().is_empty()).cloned()
}

fn normalize_database_name(name: &str) -> Result<String, DbError> {
    let cleaned = name.trim();
    if cleaned.is_empty() {
        return Err(DbError::Connection("database name is required".into()));
    }
    if cleaned == "." || cleaned == ".." || cleaned.contains(['/', '\\', '\0']) {
        return Err(DbError::Connection("invalid database name".into()));
    }
    Ok(cleaned.to_string())
}

fn config_from_request(request: &NewConnectionRequest, password: Option<String>) -> ConnectionConfig {
    ConnectionConfig {
        host: request.host.clone().unwrap_or_default(),
        port: request.port.unwrap_or_default(),
        username: request.username.clone().unwrap_or_default(),
        password,
        database: present(&request.database),
        ssl_mode: present(&request.ssl_mode),
        ssl_key_path: present(&request.ssl_key_path),
        ssl_cert_path: present(&request.ssl_cert_path),
        ssl_ca_path: present(&request.ssl_ca_path),
        file_path: present(&request.file_path),
        max_connections: 5,
    }
}

fn config_from_record(record: &SavedConnectionRecord, password: Option<String>) -> ConnectionConfig {
    ConnectionConfig {
        host: record.host.clone().unwrap_or_default(),
        port: record.port.unwrap_or_default(),
        username: record.username.clone().unwrap_or_default(),
        password,
        database: present(&record.database),
        ssl_mode: present(&record.ssl_mode),
        ssl_key_path: present(&record.ssl_key_path),
        ssl_cert_path: present(&record.ssl_cert_path),
        ssl_ca_path: present(&record.ssl_ca_path),
        file_path: present(&record.file_path),
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
        present(&request.ssh_host).as_deref(),
        request.ssh_port,
        present(&request.ssh_username).as_deref(),
        present(&request.ssh_password),
        request.ssh_use_key,
        present(&request.ssh_private_key_path).as_deref(),
        present(&request.ssh_private_key_passphrase),
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
            host: present(&request.host),
            port: request.port,
            username: present(&request.username),
            database: present(&request.database),
            ssl_mode: present(&request.ssl_mode),
            ssl_key_path: present(&request.ssl_key_path),
            ssl_cert_path: present(&request.ssl_cert_path),
            ssl_ca_path: present(&request.ssl_ca_path),
            file_path: present(&request.file_path),
            ssh_enabled: request.ssh_enabled,
            ssh_host: present(&request.ssh_host),
            ssh_port: request.ssh_port,
            ssh_username: present(&request.ssh_username),
            ssh_use_key: request.ssh_use_key,
            ssh_private_key_path: present(&request.ssh_private_key_path),
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

/// Saves edits to an existing connection.
///
/// Secrets are only touched when the form actually supplies one: an empty
/// password field means "leave the keychain entry alone", so editing the port
/// doesn't force the user to retype credentials they can't see.
///
/// A live connection is reopened with the new settings, since a pool already
/// bound to the old host would otherwise keep serving the previous target. The
/// old pool is only torn down once the replacement is known good.
#[tauri::command]
#[specta::specta]
pub async fn update_connection(
    registry: State<'_, ConnectionRegistry>,
    app_store: State<'_, AppStore>,
    id: String,
    request: NewConnectionRequest,
) -> Result<OpenedConnection, AppError> {
    if app_store.get(&id).await.map_err(AppError::from)?.is_none() {
        return Err(AppError::from(DbError::Connection(
            "saved connection not found".into(),
        )));
    }

    let record = SavedConnectionRecord {
        id: id.clone(),
        name: request.name.clone(),
        dialect: request.dialect,
        color: request.color.clone(),
        host: present(&request.host),
        port: request.port,
        username: present(&request.username),
        database: present(&request.database),
        ssl_mode: present(&request.ssl_mode),
        ssl_key_path: present(&request.ssl_key_path),
        ssl_cert_path: present(&request.ssl_cert_path),
        ssl_ca_path: present(&request.ssl_ca_path),
        file_path: present(&request.file_path),
        ssh_enabled: request.ssh_enabled,
        ssh_host: present(&request.ssh_host),
        ssh_port: request.ssh_port,
        ssh_username: present(&request.ssh_username),
        ssh_use_key: request.ssh_use_key,
        ssh_private_key_path: present(&request.ssh_private_key_path),
    };

    for (supplied, save) in [
        (&request.password, credentials::save_password as fn(&str, &str) -> Result<(), DbError>),
        (&request.ssh_password, credentials::save_ssh_password),
        (&request.ssh_private_key_passphrase, credentials::save_ssh_key_passphrase),
    ] {
        if let Some(secret) = supplied.as_deref().filter(|s| !s.is_empty()) {
            save(&id, secret).map_err(AppError::from)?;
        }
    }

    let was_connected = registry.get(&id).await.is_some();
    if was_connected {
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
                // The edit is rejected rather than half-applied: the old pool is
                // still live and still matches what's on disk.
                return Err(AppError::from(e));
            }
        };

        if let Some(old) = registry.remove(&id).await {
            let _ = old.close().await;
        }
        registry.remove_tunnel(&id).await;
        if let Some(tunnel) = tunnel {
            registry.insert_tunnel(id.clone(), tunnel).await;
        }
        registry.insert(id.clone(), driver).await;
    }

    app_store.upsert(&record).await.map_err(AppError::from)?;

    Ok(OpenedConnection {
        connection_id: id,
        dialect: record.dialect,
        display_name: record.name,
        color: record.color,
    })
}

/// Rebuilds the native menu so File ▸ Open Recent matches the saved connections.
/// Called by the frontend after a connection is added or deleted.
#[tauri::command]
#[specta::specta]
pub async fn refresh_menu(app: tauri::AppHandle) -> Result<(), AppError> {
    crate::app_menu::refresh(&app)
        .await
        .map_err(|e| AppError::from(DbError::Other(format!("failed to rebuild menu: {e}"))))
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
        present(&record.ssh_host).as_deref(),
        record.ssh_port,
        present(&record.ssh_username).as_deref(),
        ssh_password,
        record.ssh_use_key,
        present(&record.ssh_private_key_path).as_deref(),
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

    // Reconnecting over a connection the far end already dropped would otherwise
    // insert straight over the stale entries, leaving the previous pool and SSH
    // session running with nothing to close them. Torn down only now, so a
    // failed reconnect above leaves the old connection intact.
    if let Some(old) = registry.remove(&id).await {
        let _ = old.close().await;
    }
    registry.remove_tunnel(&id).await;

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
pub async fn create_database(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    database: String,
) -> Result<(), AppError> {
    let name = normalize_database_name(&database)?;
    let driver = registry
        .get(&connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))?;
    if driver.dialect() == SqlDialect::Sqlite {
        return Err(AppError::from(DbError::Unsupported(
            "SQLite connections hold a single database file".into(),
        )));
    }
    driver.create_database(&name).await.map_err(AppError::from)?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn drop_database(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    database: String,
) -> Result<(), AppError> {
    let name = normalize_database_name(&database)?;
    let driver = registry
        .get(&connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))?;
    if driver.dialect() == SqlDialect::Sqlite {
        return Err(AppError::from(DbError::Unsupported(
            "SQLite connections hold a single database file".into(),
        )));
    }
    driver.drop_database(&name).await.map_err(AppError::from)?;
    Ok(())
}

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

#[cfg(test)]
mod tests {
    use super::*;

    fn record_with_empty_paths() -> SavedConnectionRecord {
        SavedConnectionRecord {
            id: "id".into(),
            name: "n".into(),
            dialect: SqlDialect::Postgres,
            color: None,
            host: Some("db.internal".into()),
            port: Some(5432),
            username: Some("app".into()),
            database: Some(String::new()),
            ssl_mode: Some("prefer".into()),
            // How older builds persisted "the user never chose a file".
            ssl_key_path: Some(String::new()),
            ssl_cert_path: Some(String::new()),
            ssl_ca_path: Some(String::new()),
            file_path: Some(String::new()),
            ssh_enabled: false,
            ssh_host: Some(String::new()),
            ssh_port: None,
            ssh_username: Some(String::new()),
            ssh_use_key: false,
            ssh_private_key_path: Some(String::new()),
        }
    }

    /// An empty certificate path reached sqlx as `Some("")`, which it tried to
    /// open as a file — failing the connection with "no such file or directory"
    /// and no hint as to which setting was at fault.
    #[test]
    fn empty_saved_paths_are_treated_as_unset() {
        let config = config_from_record(&record_with_empty_paths(), None);
        assert_eq!(config.ssl_ca_path, None);
        assert_eq!(config.ssl_cert_path, None);
        assert_eq!(config.ssl_key_path, None);
        assert_eq!(config.file_path, None);
        assert_eq!(config.database, None);
        // Real values still survive.
        assert_eq!(config.host, "db.internal");
        assert_eq!(config.ssl_mode.as_deref(), Some("prefer"));
    }

    #[test]
    fn whitespace_only_paths_are_also_unset() {
        let mut record = record_with_empty_paths();
        record.ssl_ca_path = Some("   ".into());
        assert_eq!(config_from_record(&record, None).ssl_ca_path, None);
    }

    #[test]
    fn present_keeps_real_values_intact() {
        assert_eq!(present(&Some("/tmp/ca.pem".into())), Some("/tmp/ca.pem".into()));
        assert_eq!(present(&None), None);
        assert_eq!(present(&Some(String::new())), None);
    }

    #[test]
    fn database_name_validation_rejects_blank_and_invalid_names() {
        assert!(matches!(normalize_database_name(""), Err(_)));
        assert!(matches!(normalize_database_name("   "), Err(_)));
        assert!(matches!(normalize_database_name("my-db"), Ok(_)));
        assert!(matches!(normalize_database_name("my db"), Ok(_)));
    }
}
