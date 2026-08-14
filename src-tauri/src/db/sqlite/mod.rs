mod ddl;
mod decode;
mod introspect;
mod mutate;

use async_trait::async_trait;
use sqlx::Row;
use std::collections::HashMap;

use crate::db::{
    filter, ColumnInfo, ConnectionConfig, ConstraintInfo, DatabaseDriver, DatabaseInfo, DbError,
    DbValue, FetchOptions, ForeignKeyInfo, IndexInfo, QueryExecutionId, QueryHandle, RowPage,
    SchemaInfo, SchemaRef, SqlDialect, TableDiff, TableInfo, TableRef, TableSpec, TriggerInfo, ServerInfo, FunctionInfo,
};
use introspect::quote_ident;

pub struct SqliteDriver {
    pool: sqlx::SqlitePool,
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
        Ok(Self { pool })
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

    async fn run_query(&self, _sql: &str) -> Result<QueryHandle, DbError> {
        Err(DbError::Unsupported("M3: sql editor not yet implemented".into()))
    }
    async fn fetch_more(&self, _handle: &QueryExecutionId, _n: u32) -> Result<RowPage, DbError> {
        Err(DbError::Unsupported("M3: sql editor not yet implemented".into()))
    }
    async fn cancel(&self, _handle: &QueryExecutionId) -> Result<(), DbError> {
        Err(DbError::Unsupported("M3: sql editor not yet implemented".into()))
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
    async fn execute_ddl(&self, statements: &[String]) -> Result<(), DbError> {
        ddl::execute_ddl(&self.pool, statements).await
    }
}
