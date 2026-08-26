pub mod error;
pub mod filter;
pub mod types;

pub mod mysql;
pub mod postgres;
pub mod sqlite;

use async_trait::async_trait;
use std::collections::HashMap;
use std::sync::Arc;

pub use error::DbError;
pub use types::*;

/// Connection parameters common to all drivers. Password is resolved separately
/// via the credentials module (Keychain) and passed in at connect time — never
/// persisted as part of this struct.
#[derive(Debug, Clone)]
pub struct ConnectionConfig {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: Option<String>,
    pub database: Option<String>,
    /// libpq-style sslmode string: disable | allow | prefer | require | verify-ca | verify-full.
    /// MySQL maps this onto its own (smaller) SslMode enum on a best-effort basis.
    pub ssl_mode: Option<String>,
    pub ssl_key_path: Option<String>,
    pub ssl_cert_path: Option<String>,
    pub ssl_ca_path: Option<String>,
    /// Absolute path, SQLite only.
    pub file_path: Option<String>,
    pub max_connections: u32,
}

pub enum DbKind {
    Postgres,
    MySql,
    Sqlite,
}

/// Implemented once per dialect (`PostgresDriver`, `MySqlDriver`, `SqliteDriver`).
/// `connect()`/`test_connection()` intentionally live on the concrete structs, not
/// this trait, since `-> Self` isn't dyn-safe — `connect_driver()` below is the
/// factory that returns a trait object.
#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    fn dialect(&self) -> SqlDialect;
    async fn close(&self) -> Result<(), DbError>;
    /// Server version string and current database, for the header bar.
    async fn server_info(&self) -> Result<ServerInfo, DbError>;

    // --- schema introspection ---
    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, DbError>;
    async fn create_database(&self, name: &str) -> Result<(), DbError>;
    async fn drop_database(&self, name: &str) -> Result<(), DbError>;
    async fn list_schemas(&self, database: Option<&str>) -> Result<Vec<SchemaInfo>, DbError>;
    async fn list_tables(&self, schema: &SchemaRef) -> Result<Vec<TableInfo>, DbError>;
    async fn list_views(&self, schema: &SchemaRef) -> Result<Vec<TableInfo>, DbError>;
    async fn list_functions(&self, schema: &SchemaRef) -> Result<Vec<FunctionInfo>, DbError>;
    async fn get_columns(&self, table: &TableRef) -> Result<Vec<ColumnInfo>, DbError>;
    async fn get_indexes(&self, table: &TableRef) -> Result<Vec<IndexInfo>, DbError>;
    async fn get_constraints(&self, table: &TableRef) -> Result<Vec<ConstraintInfo>, DbError>;
    async fn get_foreign_keys(&self, table: &TableRef) -> Result<Vec<ForeignKeyInfo>, DbError>;
    async fn get_triggers(&self, table: &TableRef) -> Result<Vec<TriggerInfo>, DbError>;
    /// The CREATE statement for the table, as close to what the server reports as
    /// each dialect allows (SQLite stores it verbatim; Postgres is reconstructed).
    async fn get_table_ddl(&self, table: &TableRef) -> Result<String, DbError>;
    async fn estimated_row_count(&self, table: &TableRef) -> Result<Option<i64>, DbError>;

    // --- data access ---
    async fn fetch_rows(&self, table: &TableRef, opts: FetchOptions) -> Result<RowPage, DbError>;
    async fn run_query(&self, sql: &str) -> Result<QueryHandle, DbError>;
    async fn fetch_more(&self, handle: &QueryExecutionId, n: u32) -> Result<RowPage, DbError>;
    async fn cancel(&self, handle: &QueryExecutionId) -> Result<(), DbError>;

    // --- row mutation (requires a resolved primary key) ---
    async fn insert_row(
        &self,
        table: &TableRef,
        values: &HashMap<String, DbValue>,
    ) -> Result<String, DbError>;
    async fn update_row(
        &self,
        table: &TableRef,
        pk: &HashMap<String, DbValue>,
        changes: &HashMap<String, DbValue>,
    ) -> Result<String, DbError>;
    async fn delete_rows(
        &self,
        table: &TableRef,
        pks: &[HashMap<String, DbValue>],
    ) -> Result<Vec<String>, DbError>;

    // --- DDL: build (dry-run text) then execute separately; UI always previews first ---
    async fn build_create_table_ddl(&self, spec: &TableSpec) -> Result<Vec<String>, DbError>;
    async fn build_alter_table_ddl(
        &self,
        table: &TableRef,
        diff: &TableDiff,
    ) -> Result<Vec<String>, DbError>;
    /// Changes a single column's type/nullability/default. `new_type` is required
    /// on MySQL (which rewrites the full definition); `default` is `None` to
    /// leave it alone, `Some(None)` to drop it.
    async fn build_edit_column_ddl(
        &self,
        table: &TableRef,
        column: &str,
        new_type: Option<&str>,
        nullable: Option<bool>,
        default: Option<Option<String>>,
    ) -> Result<Vec<String>, DbError>;
    async fn build_drop_table_ddl(&self, table: &TableRef) -> Result<Vec<String>, DbError>;
    async fn build_truncate_table_ddl(&self, table: &TableRef) -> Result<Vec<String>, DbError>;
    async fn execute_ddl(&self, statements: &[String]) -> Result<(), DbError>;
}

pub async fn connect_driver(
    kind: DbKind,
    config: &ConnectionConfig,
) -> Result<Arc<dyn DatabaseDriver>, DbError> {
    match kind {
        DbKind::Postgres => Ok(Arc::new(postgres::PostgresDriver::connect(config).await?)),
        DbKind::MySql => Ok(Arc::new(mysql::MySqlDriver::connect(config).await?)),
        DbKind::Sqlite => Ok(Arc::new(sqlite::SqliteDriver::connect(config).await?)),
    }
}

/// Splits a full result set into the first page and whether more rows remain,
/// used by every driver's `run_query` to back pagination.
pub fn split_page<T: Clone>(rows: &[T], page_size: usize) -> (Vec<T>, bool) {
    let has_more = rows.len() > page_size;
    (rows.iter().take(page_size).cloned().collect(), has_more)
}
