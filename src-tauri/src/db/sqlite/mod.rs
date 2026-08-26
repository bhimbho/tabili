mod ddl;
mod decode;
mod introspect;
mod mutate;

use async_trait::async_trait;
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Mutex;

use crate::db::{
    filter, split_page, ColumnInfo, ConnectionConfig, ConstraintInfo, DatabaseDriver, DatabaseInfo,
    DbError, DbValue, FetchOptions, ForeignKeyInfo, IndexInfo, QueryExecutionId, QueryHandle,
    RowPage, SchemaInfo, SchemaRef, SqlDialect, TableDiff, TableInfo, TableRef, TableSpec,
    TriggerInfo, ServerInfo, FunctionInfo, DbUser, DbGrant,
};
use introspect::quote_ident;

/// How many rows `run_query` returns on the first call; further rows are paged
/// via `fetch_more` against an in-memory buffer.
const QUERY_PAGE_SIZE: usize = 500;

struct CachedResult {
    columns: Vec<String>,
    rows: Vec<HashMap<String, DbValue>>,
    sql: String,
}

pub struct SqliteDriver {
    pool: sqlx::SqlitePool,
    query_cache: Mutex<HashMap<String, CachedResult>>,
}

impl SqliteDriver {
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, DbError> {
        let path = config
            .file_path
            .as_deref()
            .filter(|p| !p.is_empty())
            .ok_or_else(|| DbError::Connection("sqlite connection requires file_path".into()))?;
        let pool = sqlx::sqlite::SqlitePoolOptions::new()
            .max_connections(config.max_connections.max(1))
            .connect(&format!("sqlite://{path}"))
            .await
            .map_err(|e| DbError::Connection(e.to_string()))?;
        Ok(Self { pool, query_cache: Mutex::new(HashMap::new()) })
    }
}

#[async_trait]
impl DatabaseDriver for SqliteDriver {
    fn dialect(&self) -> SqlDialect {
        SqlDialect::Sqlite
    }

    async fn close(&self) -> Result<(), DbError> {
        self.pool.close().await;
        Ok(())
    }

    async fn server_info(&self) -> Result<ServerInfo, DbError> {
        let row = sqlx::query("SELECT sqlite_version() AS v")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(ServerInfo {
            version: format!("SQLite {}", row.get::<String, _>("v")),
            database: "main".to_string(),
        })
    }

    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, DbError> {
        // A SQLite connection is always scoped to a single file/database.
        Ok(vec![DatabaseInfo { name: "main".to_string() }])
    }
    async fn create_database(&self, _name: &str) -> Result<(), DbError> {
        Err(DbError::Unsupported(
            "SQLite connections only manage a single file-backed database".into(),
        ))
    }
    async fn drop_database(&self, _name: &str) -> Result<(), DbError> {
        Err(DbError::Unsupported(
            "SQLite connections only manage a single file-backed database".into(),
        ))
    }
    async fn list_schemas(&self, _database: Option<&str>) -> Result<Vec<SchemaInfo>, DbError> {
        // SQLite has no schema concept beyond the single implicit "main".
        Ok(vec![])
    }
    async fn list_tables(&self, _schema: &SchemaRef) -> Result<Vec<TableInfo>, DbError> {
        introspect::list_tables(&self.pool).await
    }
    async fn list_views(&self, _schema: &SchemaRef) -> Result<Vec<TableInfo>, DbError> {
        introspect::list_views(&self.pool).await
    }
    async fn list_functions(&self, _schema: &SchemaRef) -> Result<Vec<FunctionInfo>, DbError> {
        // SQLite has no catalog of user-defined functions.
        Ok(vec![])
    }
    async fn get_columns(&self, table: &TableRef) -> Result<Vec<ColumnInfo>, DbError> {
        introspect::get_columns(&self.pool, &table.table).await
    }
    async fn get_indexes(&self, table: &TableRef) -> Result<Vec<IndexInfo>, DbError> {
        introspect::get_indexes(&self.pool, &table.table).await
    }
    async fn get_constraints(&self, _table: &TableRef) -> Result<Vec<ConstraintInfo>, DbError> {
        // CHECK/UNIQUE constraint introspection deferred past M1; primary keys are
        // exposed via ColumnInfo.is_primary_key and foreign keys via get_foreign_keys.
        Ok(vec![])
    }
    async fn get_foreign_keys(&self, table: &TableRef) -> Result<Vec<ForeignKeyInfo>, DbError> {
        introspect::get_foreign_keys(&self.pool, &table.table).await
    }
    async fn get_triggers(&self, table: &TableRef) -> Result<Vec<TriggerInfo>, DbError> {
        introspect::get_triggers(&self.pool, &table.table).await
    }
    async fn get_table_ddl(&self, table: &TableRef) -> Result<String, DbError> {
        introspect::get_table_ddl(&self.pool, &table.table).await
    }
    async fn estimated_row_count(&self, table: &TableRef) -> Result<Option<i64>, DbError> {
        introspect::estimated_row_count(&self.pool, &table.table).await
    }

    async fn fetch_rows(&self, table: &TableRef, opts: FetchOptions) -> Result<RowPage, DbError> {
        let where_clause = filter::build_where(
            &opts.filters,
            filter::Dialect {
                quote: quote_ident,
                placeholder: || "?".to_string(),
                cast_text: |col: &str| format!("CAST({col} AS TEXT)"),
                // SQLite's LIKE is already case-insensitive for ASCII.
                like: "LIKE",
            },
        );
        let order = filter::order_clause(opts.order_by.as_ref(), opts.order_desc, quote_ident);
        let query = format!(
            "SELECT * FROM {}{}{} LIMIT ? OFFSET ?",
            quote_ident(&table.table),
            where_clause.sql,
            order
        );

        // Fetch one extra row to cheaply determine has_more without a separate COUNT(*).
        let fetch_limit = opts.limit as i64 + 1;
        let mut q = sqlx::query(sqlx::AssertSqlSafe(query.clone()));
        for value in &where_clause.binds {
            q = mutate::bind_value(q, value)?;
        }
        let rows = q
            .bind(fetch_limit)
            .bind(opts.offset as i64)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;

        let has_more = rows.len() as u32 > opts.limit;
        let mut columns: Vec<String> = Vec::new();
        let mut out_rows = Vec::new();
        for row in rows.iter().take(opts.limit as usize) {
            if columns.is_empty() {
                columns = decode::column_names(row);
            }
            let mut map = HashMap::new();
            for (i, name) in columns.iter().enumerate() {
                map.insert(name.clone(), decode::decode_value(row, i));
            }
            out_rows.push(map);
        }

        Ok(RowPage { columns, rows: out_rows, has_more, sql: query })
    }

    async fn run_query(&self, sql: &str) -> Result<QueryHandle, DbError> {
        let rows = sqlx::query(sqlx::AssertSqlSafe(sql.to_string()))
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;

        let mut columns: Vec<String> = Vec::new();
        let mut all_rows = Vec::new();
        for row in &rows {
            if columns.is_empty() {
                columns = decode::column_names(row);
            }
            let mut map = HashMap::new();
            for (i, name) in columns.iter().enumerate() {
                map.insert(name.clone(), decode::decode_value(row, i));
            }
            all_rows.push(map);
        }

        let execution_id = uuid::Uuid::new_v4().to_string();
        let cached = CachedResult { columns, rows: all_rows, sql: sql.to_string() };

        let (first_page_rows, has_more) = split_page(&cached.rows, QUERY_PAGE_SIZE);
        let first_page = RowPage {
            columns: cached.columns.clone(),
            rows: first_page_rows,
            has_more,
            sql: sql.to_string(),
        };

        self.query_cache
            .lock()
            .unwrap()
            .insert(execution_id.clone(), cached);

        Ok(QueryHandle {
            execution_id: QueryExecutionId(execution_id),
            first_page,
        })
    }

    async fn fetch_more(&self, handle: &QueryExecutionId, n: u32) -> Result<RowPage, DbError> {
        let mut cache = self.query_cache.lock().unwrap();
        let cached = cache
            .get_mut(&handle.0)
            .ok_or_else(|| DbError::Query("unknown or expired query execution".into()))?;

        let offset = n as usize;
        let next = cached
            .rows
            .iter()
            .skip(offset)
            .take(QUERY_PAGE_SIZE)
            .cloned()
            .collect::<Vec<_>>();
        let has_more = offset + next.len() < cached.rows.len();

        Ok(RowPage {
            columns: cached.columns.clone(),
            rows: next,
            has_more,
            sql: cached.sql.clone(),
        })
    }

    async fn cancel(&self, _handle: &QueryExecutionId) -> Result<(), DbError> {
        Ok(())
    }

    async fn insert_row(
        &self,
        table: &TableRef,
        values: &HashMap<String, DbValue>,
    ) -> Result<String, DbError> {
        mutate::insert_row(&self.pool, &table.table, values).await
    }
    async fn update_row(
        &self,
        table: &TableRef,
        pk: &HashMap<String, DbValue>,
        changes: &HashMap<String, DbValue>,
    ) -> Result<String, DbError> {
        mutate::update_row(&self.pool, &table.table, pk, changes).await
    }
    async fn delete_rows(
        &self,
        table: &TableRef,
        pks: &[HashMap<String, DbValue>],
    ) -> Result<Vec<String>, DbError> {
        mutate::delete_rows(&self.pool, &table.table, pks).await
    }

    async fn build_create_table_ddl(&self, spec: &TableSpec) -> Result<Vec<String>, DbError> {
        ddl::build_create_table_ddl(spec)
    }
    async fn build_alter_table_ddl(
        &self,
        table: &TableRef,
        diff: &TableDiff,
    ) -> Result<Vec<String>, DbError> {
        ddl::build_alter_table_ddl(&table.table, diff)
    }
    async fn build_drop_table_ddl(&self, table: &TableRef) -> Result<Vec<String>, DbError> {
        Ok(ddl::build_drop_table_ddl(&table.table))
    }
    async fn build_truncate_table_ddl(&self, table: &TableRef) -> Result<Vec<String>, DbError> {
        Ok(ddl::build_truncate_table_ddl(&table.table))
    }
    async fn build_edit_column_ddl(
        &self,
        _table: &TableRef,
        _column: &str,
        _new_type: Option<&str>,
        _nullable: Option<bool>,
        _default: Option<Option<String>>,
    ) -> Result<Vec<String>, DbError> {
        // SQLite's ALTER TABLE can't change a column's type or nullability, and
        // changing DEFAULT requires a full table recreate. Keep this explicit
        // rather than silently doing nothing.
        Err(DbError::Unsupported(
            "SQLite cannot alter a column's type or nullability; drop and re-add it instead".into(),
        ))
    }
    async fn build_create_index_ddl(
        &self,
        table: &TableRef,
        index_name: &str,
        unique: bool,
        columns: &[String],
    ) -> Result<Vec<String>, DbError> {
        Ok(vec![ddl::build_create_index_ddl(
            &table.table,
            index_name,
            unique,
            columns,
        )])
    }
    async fn build_drop_index_ddl(&self, _table: &TableRef, index_name: &str) -> Result<Vec<String>, DbError> {
        Ok(vec![format!("DROP INDEX {}", introspect::quote_ident(index_name))])
    }
    async fn execute_ddl(&self, statements: &[String]) -> Result<(), DbError> {
        ddl::execute_ddl(&self.pool, statements).await
    }

    // --- user management (not supported for SQLite) ---
    async fn list_users(&self) -> Result<Vec<DbUser>, DbError> {
        Ok(vec![])
    }
    async fn create_user(
        &self,
        _name: &str,
        _password: &str,
        _host: Option<&str>,
        _superuser: bool,
    ) -> Result<(), DbError> {
        Err(DbError::Unsupported(
            "SQLite does not support user management".into(),
        ))
    }
    async fn drop_user(&self, _name: &str, _host: Option<&str>) -> Result<(), DbError> {
        Err(DbError::Unsupported(
            "SQLite does not support user management".into(),
        ))
    }
    async fn alter_user_password(
        &self,
        _name: &str,
        _host: Option<&str>,
        _new_password: &str,
    ) -> Result<(), DbError> {
        Err(DbError::Unsupported(
            "SQLite does not support user management".into(),
        ))
    }
    async fn user_grants(&self, _name: &str, _host: Option<&str>) -> Result<Vec<DbGrant>, DbError> {
        Ok(vec![])
    }
    async fn grant_privilege(
        &self,
        _name: &str,
        _host: Option<&str>,
        _privilege: &str,
        _schema: Option<&str>,
        _table: Option<&str>,
    ) -> Result<(), DbError> {
        Err(DbError::Unsupported(
            "SQLite does not support user management".into(),
        ))
    }
    async fn revoke_privilege(
        &self,
        _name: &str,
        _host: Option<&str>,
        _privilege: &str,
        _schema: Option<&str>,
        _table: Option<&str>,
    ) -> Result<(), DbError> {
        Err(DbError::Unsupported(
            "SQLite does not support user management".into(),
        ))
    }
}
