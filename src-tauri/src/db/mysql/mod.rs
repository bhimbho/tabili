use async_trait::async_trait;
use std::collections::HashMap;

use crate::db::{
    ColumnInfo, ConnectionConfig, ConstraintInfo, DatabaseDriver, DatabaseInfo, DbError, DbValue,
    FetchOptions, ForeignKeyInfo, IndexInfo, QueryExecutionId, QueryHandle, RowPage, SchemaInfo,
    SchemaRef, SqlDialect, TableDiff, TableInfo, TableRef, TableSpec, TriggerInfo, ServerInfo, FunctionInfo,
};

/// MySQL/MariaDB driver — implemented in full as part of the M2 milestone (see project plan).
/// This is the M0 scaffold: it compiles and satisfies the trait so the rest of
/// the app can be wired up before the real introspection/query logic lands.
pub struct MySqlDriver {
    pool: sqlx::MySqlPool,
}

impl MySqlDriver {
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, DbError> {
        let mut opts = sqlx::mysql::MySqlConnectOptions::new()
            .host(&config.host)
            .port(config.port)
            .username(&config.username);
        if let Some(db) = &config.database {
            opts = opts.database(db);
        }
        if let Some(password) = &config.password {
            opts = opts.password(password);
        }
        if let Some(mode) = &config.ssl_mode {
            // MySQL's SslMode enum is smaller than Postgres's libpq-style modes; map
            // onto the closest equivalent rather than requiring a separate UI.
            use sqlx::mysql::MySqlSslMode;
            let mode = match mode.to_ascii_lowercase().as_str() {
                "disable" => MySqlSslMode::Disabled,
                "allow" | "prefer" => MySqlSslMode::Preferred,
                "require" => MySqlSslMode::Required,
                "verify-ca" => MySqlSslMode::VerifyCa,
                "verify-full" => MySqlSslMode::VerifyIdentity,
                _ => return Err(DbError::Connection(format!("invalid ssl_mode: {mode}"))),
            };
            opts = opts.ssl_mode(mode);
        }
        if let Some(ca) = &config.ssl_ca_path {
            opts = opts.ssl_ca(ca);
        }
        if let Some(cert) = &config.ssl_cert_path {
            opts = opts.ssl_client_cert(cert);
        }
        if let Some(key) = &config.ssl_key_path {
            opts = opts.ssl_client_key(key);
        }
        let pool = sqlx::mysql::MySqlPoolOptions::new()
            .max_connections(config.max_connections.max(1))
            .connect_with(opts)
            .await
            .map_err(|e| DbError::Connection(e.to_string()))?;
        Ok(Self { pool })
    }
}

#[async_trait]
impl DatabaseDriver for MySqlDriver {
    fn dialect(&self) -> SqlDialect {
        SqlDialect::MySql
    }

    async fn close(&self) -> Result<(), DbError> {
        self.pool.close().await;
        Ok(())
    }

    async fn server_info(&self) -> Result<ServerInfo, DbError> {
        Err(DbError::Unsupported("mysql driver not yet implemented".into()))
    }

    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn list_schemas(&self, _database: Option<&str>) -> Result<Vec<SchemaInfo>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn list_tables(&self, _schema: &SchemaRef) -> Result<Vec<TableInfo>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn list_views(&self, _schema: &SchemaRef) -> Result<Vec<TableInfo>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn list_functions(&self, _schema: &SchemaRef) -> Result<Vec<FunctionInfo>, DbError> {
        Err(DbError::Unsupported("mysql driver not yet implemented".into()))
    }
    async fn get_columns(&self, _table: &TableRef) -> Result<Vec<ColumnInfo>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn get_indexes(&self, _table: &TableRef) -> Result<Vec<IndexInfo>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn get_constraints(&self, _table: &TableRef) -> Result<Vec<ConstraintInfo>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn get_foreign_keys(&self, _table: &TableRef) -> Result<Vec<ForeignKeyInfo>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn get_triggers(&self, _table: &TableRef) -> Result<Vec<TriggerInfo>, DbError> {
        Err(DbError::Unsupported("mysql driver not yet implemented".into()))
    }
    async fn get_table_ddl(&self, _table: &TableRef) -> Result<String, DbError> {
        Err(DbError::Unsupported("mysql driver not yet implemented".into()))
    }
    async fn estimated_row_count(&self, _table: &TableRef) -> Result<Option<i64>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }

    async fn fetch_rows(&self, _table: &TableRef, _opts: FetchOptions) -> Result<RowPage, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn run_query(&self, _sql: &str) -> Result<QueryHandle, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn fetch_more(&self, _handle: &QueryExecutionId, _n: u32) -> Result<RowPage, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn cancel(&self, _handle: &QueryExecutionId) -> Result<(), DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }

    async fn insert_row(
        &self,
        _table: &TableRef,
        _values: &HashMap<String, DbValue>,
    ) -> Result<String, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn update_row(
        &self,
        _table: &TableRef,
        _pk: &HashMap<String, DbValue>,
        _changes: &HashMap<String, DbValue>,
    ) -> Result<String, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn delete_rows(
        &self,
        _table: &TableRef,
        _pks: &[HashMap<String, DbValue>],
    ) -> Result<Vec<String>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }

    async fn build_create_table_ddl(&self, _spec: &TableSpec) -> Result<Vec<String>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn build_alter_table_ddl(
        &self,
        _table: &TableRef,
        _diff: &TableDiff,
    ) -> Result<Vec<String>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn build_drop_table_ddl(&self, _table: &TableRef) -> Result<Vec<String>, DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
    async fn execute_ddl(&self, _statements: &[String]) -> Result<(), DbError> {
        Err(DbError::Unsupported("M2: mysql driver not yet implemented".into()))
    }
}
