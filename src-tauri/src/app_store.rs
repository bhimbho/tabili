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
pub struct StatementLogEntry {
    pub id: String,
    pub connection_id: String,
    pub sql: String,
    pub success: bool,
    pub error: Option<String>,
    #[specta(type = specta_typescript::Number)]
    pub duration_ms: i64,
    pub executed_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedQuery {
    pub id: String,
    pub name: String,
    pub sql: String,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SavedConnectionRecord {
    pub id: String,
    pub name: String,
    pub dialect: SqlDialect,
    /// Hex accent used across the rail and header. Red conventionally marks
    /// production so destructive actions are visually obvious.
    pub color: Option<String>,
    pub host: Option<String>,
    pub port: Option<u16>,
    pub username: Option<String>,
    pub database: Option<String>,
    pub ssl_mode: Option<String>,
    pub ssl_key_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_ca_path: Option<String>,
    pub file_path: Option<String>,
    pub ssh_enabled: bool,
    pub ssh_host: Option<String>,
    pub ssh_port: Option<u16>,
    pub ssh_username: Option<String>,
    pub ssh_use_key: bool,
    pub ssh_private_key_path: Option<String>,
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

        // Added after the initial release; ignore the error when it already exists
        // rather than tracking a migration version for a single column.
        let _ = sqlx::query("ALTER TABLE saved_connections ADD COLUMN color TEXT")
            .execute(&self.pool)
            .await;

        for stmt in [
            "ALTER TABLE saved_connections ADD COLUMN ssh_enabled INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE saved_connections ADD COLUMN ssh_host TEXT",
            "ALTER TABLE saved_connections ADD COLUMN ssh_port INTEGER",
            "ALTER TABLE saved_connections ADD COLUMN ssh_username TEXT",
            "ALTER TABLE saved_connections ADD COLUMN ssh_use_key INTEGER NOT NULL DEFAULT 0",
            "ALTER TABLE saved_connections ADD COLUMN ssh_private_key_path TEXT",
        ] {
            let _ = sqlx::query(stmt).execute(&self.pool).await;
        }

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS statement_log (
                id TEXT PRIMARY KEY,
                connection_id TEXT NOT NULL,
                sql TEXT NOT NULL,
                success INTEGER NOT NULL,
                error TEXT,
                duration_ms INTEGER NOT NULL,
                executed_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
        )
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::Other(e.to_string()))?;

        sqlx::query(
            "CREATE TABLE IF NOT EXISTS saved_queries (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sql TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )",
        )
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::Other(e.to_string()))?;
        Ok(())
    }

    pub async fn log_statement(&self, entry: &StatementLogEntry) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO statement_log (id, connection_id, sql, success, error, duration_ms)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        )
        .bind(&entry.id)
        .bind(&entry.connection_id)
        .bind(&entry.sql)
        .bind(entry.success as i64)
        .bind(&entry.error)
        .bind(entry.duration_ms)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::Other(e.to_string()))?;
        // Keep history bounded so the store cannot grow without limit.
        let _ = sqlx::query(
            "DELETE FROM statement_log WHERE id NOT IN
             (SELECT id FROM statement_log ORDER BY executed_at DESC, rowid DESC LIMIT 2000)",
        )
        .execute(&self.pool)
        .await;
        Ok(())
    }

    pub async fn list_statement_log(&self, limit: u32) -> Result<Vec<StatementLogEntry>, DbError> {
        let rows = sqlx::query(
            "SELECT * FROM statement_log ORDER BY executed_at DESC, rowid DESC LIMIT ?1",
        )
        .bind(limit as i64)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DbError::Other(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|r| StatementLogEntry {
                id: r.get("id"),
                connection_id: r.get("connection_id"),
                sql: r.get("sql"),
                success: r.get::<i64, _>("success") != 0,
                error: r.try_get("error").ok(),
                duration_ms: r.get("duration_ms"),
                executed_at: r.get("executed_at"),
            })
            .collect())
    }

    pub async fn clear_statement_log(&self) -> Result<(), DbError> {
        sqlx::query("DELETE FROM statement_log")
            .execute(&self.pool)
            .await
            .map_err(|e| DbError::Other(e.to_string()))?;
        Ok(())
    }

    pub async fn save_query(&self, q: &SavedQuery) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO saved_queries (id, name, sql) VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET name = excluded.name, sql = excluded.sql",
        )
        .bind(&q.id)
        .bind(&q.name)
        .bind(&q.sql)
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::Other(e.to_string()))?;
        Ok(())
    }

    pub async fn list_saved_queries(&self) -> Result<Vec<SavedQuery>, DbError> {
        let rows = sqlx::query("SELECT * FROM saved_queries ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DbError::Other(e.to_string()))?;
        Ok(rows
            .into_iter()
            .map(|r| SavedQuery {
                id: r.get("id"),
                name: r.get("name"),
                sql: r.get("sql"),
                created_at: r.get("created_at"),
            })
            .collect())
    }

    pub async fn delete_saved_query(&self, id: &str) -> Result<(), DbError> {
        sqlx::query("DELETE FROM saved_queries WHERE id = ?1")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| DbError::Other(e.to_string()))?;
        Ok(())
    }

    pub async fn upsert(&self, record: &SavedConnectionRecord) -> Result<(), DbError> {
        sqlx::query(
            "INSERT INTO saved_connections
                (id, name, dialect, host, port, username, database, ssl_mode, ssl_key_path, ssl_cert_path, ssl_ca_path, file_path, color,
                 ssh_enabled, ssh_host, ssh_port, ssh_username, ssh_use_key, ssh_private_key_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name, dialect = excluded.dialect, host = excluded.host,
                port = excluded.port, username = excluded.username, database = excluded.database,
                ssl_mode = excluded.ssl_mode, ssl_key_path = excluded.ssl_key_path,
                ssl_cert_path = excluded.ssl_cert_path, ssl_ca_path = excluded.ssl_ca_path,
                file_path = excluded.file_path, color = excluded.color,
                ssh_enabled = excluded.ssh_enabled, ssh_host = excluded.ssh_host,
                ssh_port = excluded.ssh_port, ssh_username = excluded.ssh_username,
                ssh_use_key = excluded.ssh_use_key, ssh_private_key_path = excluded.ssh_private_key_path",
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
        .bind(&record.color)
        .bind(record.ssh_enabled as i64)
        .bind(&record.ssh_host)
        .bind(record.ssh_port.map(|p| p as i64))
        .bind(&record.ssh_username)
        .bind(record.ssh_use_key as i64)
        .bind(&record.ssh_private_key_path)
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
            color: row.try_get("color").ok(),
                host: row.try_get("host").ok(),
                port: row.try_get::<i64, _>("port").ok().map(|p| p as u16),
                username: row.try_get("username").ok(),
                database: row.try_get("database").ok(),
                ssl_mode: row.try_get("ssl_mode").ok(),
                ssl_key_path: row.try_get("ssl_key_path").ok(),
                ssl_cert_path: row.try_get("ssl_cert_path").ok(),
                ssl_ca_path: row.try_get("ssl_ca_path").ok(),
                file_path: row.try_get("file_path").ok(),
                ssh_enabled: row.try_get::<i64, _>("ssh_enabled").unwrap_or(0) != 0,
                ssh_host: row.try_get("ssh_host").ok(),
                ssh_port: row.try_get::<i64, _>("ssh_port").ok().map(|p| p as u16),
                ssh_username: row.try_get("ssh_username").ok(),
                ssh_use_key: row.try_get::<i64, _>("ssh_use_key").unwrap_or(0) != 0,
                ssh_private_key_path: row.try_get("ssh_private_key_path").ok(),
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
            color: row.try_get("color").ok(),
            host: row.try_get("host").ok(),
            port: row.try_get::<i64, _>("port").ok().map(|p| p as u16),
            username: row.try_get("username").ok(),
            database: row.try_get("database").ok(),
            ssl_mode: row.try_get("ssl_mode").ok(),
            ssl_key_path: row.try_get("ssl_key_path").ok(),
            ssl_cert_path: row.try_get("ssl_cert_path").ok(),
            ssl_ca_path: row.try_get("ssl_ca_path").ok(),
            file_path: row.try_get("file_path").ok(),
            ssh_enabled: row.try_get::<i64, _>("ssh_enabled").unwrap_or(0) != 0,
            ssh_host: row.try_get("ssh_host").ok(),
            ssh_port: row.try_get::<i64, _>("ssh_port").ok().map(|p| p as u16),
            ssh_username: row.try_get("ssh_username").ok(),
            ssh_use_key: row.try_get::<i64, _>("ssh_use_key").unwrap_or(0) != 0,
            ssh_private_key_path: row.try_get("ssh_private_key_path").ok(),
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
