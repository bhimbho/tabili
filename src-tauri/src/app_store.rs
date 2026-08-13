use serde::{Deserialize, Serialize};
use specta::Type;
use sqlx::{Row, SqlitePool};
use std::path::Path;

use crate::db::error::DbError;
use crate::db::SqlDialect;

/// Local app-owned metadata store (saved connection profiles, no passwords —
/// those live in the OS keychain, see credentials.rs).
pub struct AppStore {
    pool: SqlitePool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnectionRecord {
    pub id: String,
    pub name: String,
    pub dialect: SqlDialect,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub database: Option<String>,
    pub ssl_mode: Option<String>,
    pub ssl_key_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_ca_path: Option<String>,
    pub file_path: Option<String>,
}

fn dialect_to_str(d: SqlDialect) -> &'static str {
    match d {
        SqlDialect::Postgres => "postgres",
        SqlDialect::MySql => "mysql",
        SqlDialect::Sqlite => "sqlite",
    }
}

fn dialect_from_str(s: &str) -> SqlDialect {
    match s {
        "postgres" => SqlDialect::Postgres,
        "mysql" => SqlDialect::MySql,
        _ => SqlDialect::Sqlite,
    }
}

impl AppStore {
    /// `connect_lazy` avoids needing an async context during Tauri's synchronous
    /// `.setup()` — the pool connects on first actual query.
    pub fn open(data_dir: &Path) -> Result<Self, DbError> {
        std::fs::create_dir_all(data_dir)
            .map_err(|e| DbError::Other(format!("failed to create app data dir: {e}")))?;
        let db_path = data_dir.join("tabili.db");
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(1)
            .connect_lazy(&format!("sqlite://{}?mode=rwc", db_path.display()))
            .map_err(|e| DbError::Other(e.to_string()))?;
        Ok(Self { pool })
    }

    pub async fn migrate(&self) -> Result<(), DbError> {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS saved_connections (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                dialect TEXT NOT NULL,
                host TEXT,
                port INTEGER,
                username TEXT,
                database TEXT,
                ssl_mode TEXT,
                ssl_key_path TEXT,
                ssl_cert_path TEXT,
                ssl_ca_path TEXT,
                file_path TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
        )
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::Other(e.to_string()))?;
        Ok(())
    }

    pub async fn upsert(&self, record: &SavedConnectionRecord) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO saved_connections
                (id, name, dialect, host, port, username, database, ssl_mode, ssl_key_path, ssl_cert_path, ssl_ca_path, file_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, dialect = excluded.dialect, host = excluded.host,
                port = excluded.port, username = excluded.username, database = excluded.database,
                ssl_mode = excluded.ssl_mode, ssl_key_path = excluded.ssl_key_path,
                ssl_cert_path = excluded.ssl_cert_path, ssl_ca_path = excluded.ssl_ca_path,
                file_path = excluded.file_path",
        )
        .bind(&record.id)
        .bind(&record.name)
        .bind(dialect_to_str(record.dialect))
        .bind(&record.host)
        .bind(record.port.map(|p| p as i64))
        .bind(&record.username)
        .bind(&record.database)
        .bind(&record.ssl_mode)
        .bind(&record.ssl_key_path)
        .bind(&record.ssl_cert_path)
        .bind(&record.ssl_ca_path)
        .bind(&record.file_path)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::Other(e.to_string()))?;
        Ok(())
    }

    pub async fn list(&self) -> Result<Vec<SavedConnectionRecord>, DbError> {
        let rows = sqlx::query("SELECT * FROM saved_connections ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DbError::Other(e.to_string()))?;

        Ok(rows
            .into_iter()
            .map(|row| SavedConnectionRecord {
                id: row.get("id"),
                name: row.get("name"),
                dialect: dialect_from_str(row.get::<String, _>("dialect").as_str()),
                host: row.try_get("host").ok(),
                port: row.try_get::<i64, _>("port").ok().map(|p| p as u16),
                username: row.try_get("username").ok(),
                database: row.try_get("database").ok(),
                ssl_mode: row.try_get("ssl_mode").ok(),
                ssl_key_path: row.try_get("ssl_key_path").ok(),
                ssl_cert_path: row.try_get("ssl_cert_path").ok(),
                ssl_ca_path: row.try_get("ssl_ca_path").ok(),
                file_path: row.try_get("file_path").ok(),
            })
            .collect())
    }

    pub async fn get(&self, id: &str) -> Result<Option<SavedConnectionRecord>, DbError> {
        let row = sqlx::query("SELECT * FROM saved_connections WHERE id = ?1")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| DbError::Other(e.to_string()))?;

        Ok(row.map(|row| SavedConnectionRecord {
            id: row.get("id"),
            name: row.get("name"),
            dialect: dialect_from_str(row.get::<String, _>("dialect").as_str()),
            host: row.try_get("host").ok(),
            port: row.try_get::<i64, _>("port").ok().map(|p| p as u16),
            username: row.try_get("username").ok(),
            database: row.try_get("database").ok(),
            ssl_mode: row.try_get("ssl_mode").ok(),
            ssl_key_path: row.try_get("ssl_key_path").ok(),
            ssl_cert_path: row.try_get("ssl_cert_path").ok(),
            ssl_ca_path: row.try_get("ssl_ca_path").ok(),
            file_path: row.try_get("file_path").ok(),
        }))
    }

    pub async fn delete(&self, id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM saved_connections WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| DbError::Other(e.to_string()))?;
        Ok(())
    }
}
