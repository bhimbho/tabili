mod ddl;
mod decode;
mod introspect;
mod mutate;

use async_trait::async_trait;
use sqlx::postgres::PgSslMode;
use std::collections::HashMap;
use std::str::FromStr;
use std::sync::Mutex;

use sqlx::Row;

use crate::db::{
    filter, split_page, ColumnInfo, ConnectionConfig, ConstraintInfo, DatabaseDriver, DatabaseInfo,
    DbError, DbValue, FetchOptions, ForeignKeyInfo, IndexInfo, QueryExecutionId, QueryHandle,
    RowPage, SchemaInfo, SchemaRef, SqlDialect, TableDiff, TableInfo, TableRef, TableSpec,
    TriggerInfo, ServerInfo, FunctionInfo,
};
use introspect::{quote_ident, quote_qualified};

const DEFAULT_SCHEMA: &str = "public";

/// How many rows `run_query` returns on the first call. Further rows are fetched
/// via `fetch_more` against an in-memory buffer keyed by execution id.
const QUERY_PAGE_SIZE: usize = 500;

/// A fully-materialized result set held for a single query execution, so the
/// frontend can page through it with `fetch_more` without re-running the SQL.
struct CachedResult {
    columns: Vec<String>,
    rows: Vec<HashMap<String, DbValue>>,
    sql: String,
}

pub struct PostgresDriver {
    pool: sqlx::PgPool,
    query_cache: Mutex<HashMap<String, CachedResult>>,
}

impl PostgresDriver {
    pub async fn connect(config: &ConnectionConfig) -> Result<Self, DbError> {
        let mut opts = sqlx::postgres::PgConnectOptions::new()
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
            let mode = PgSslMode::from_str(mode)
                .map_err(|_| DbError::Connection(format!("invalid ssl_mode: {mode}")))?;
            opts = opts.ssl_mode(mode);
        }
        if let Some(ca) = config.ssl_ca_path.as_deref().filter(|p| !p.is_empty()) {
            opts = opts.ssl_root_cert(ca);
        }
        if let Some(cert) = config.ssl_cert_path.as_deref().filter(|p| !p.is_empty()) {
            opts = opts.ssl_client_cert(cert);
        }
        if let Some(key) = config.ssl_key_path.as_deref().filter(|p| !p.is_empty()) {
            opts = opts.ssl_client_key(key);
        }

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(config.max_connections.max(1))
            .connect_with(opts)
            .await
            .map_err(|e| DbError::Connection(e.to_string()))?;
        Ok(Self { pool, query_cache: Mutex::new(HashMap::new()) })
    }

    fn schema_of<'a>(schema: &'a SchemaRef) -> &'a str {
        schema.schema.as_deref().unwrap_or(DEFAULT_SCHEMA)
    }
}

#[async_trait]
impl DatabaseDriver for PostgresDriver {
    fn dialect(&self) -> SqlDialect {
        SqlDialect::Postgres
    }

    async fn close(&self) -> Result<(), DbError> {
        self.pool.close().await;
        Ok(())
    }

    async fn server_info(&self) -> Result<ServerInfo, DbError> {
        let row = sqlx::query(
            "SELECT current_setting('server_version') AS v, current_database() AS d",
        )
        .fetch_one(&self.pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(ServerInfo {
            version: format!("PostgreSQL {}", row.get::<String, _>("v")),
            database: row.get::<String, _>("d"),
        })
    }

    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, DbError> {
        Ok(introspect::list_databases(&self.pool)
            .await?
            .into_iter()
            .map(|name| DatabaseInfo { name })
            .collect())
    }
    async fn create_database(&self, name: &str) -> Result<(), DbError> {
        let clean = name.trim();
        let quoted = quote_ident(clean);
        sqlx::query(sqlx::AssertSqlSafe(format!("CREATE DATABASE {quoted}")))
            .execute(&self.pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(())
    }
    async fn drop_database(&self, name: &str) -> Result<(), DbError> {
        let clean = name.trim();
        let quoted = quote_ident(clean);
        sqlx::query(sqlx::AssertSqlSafe(format!("DROP DATABASE {quoted}")))
            .execute(&self.pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(())
    }
    async fn list_schemas(&self, _database: Option<&str>) -> Result<Vec<SchemaInfo>, DbError> {
        Ok(introspect::list_schemas(&self.pool)
            .await?
            .into_iter()
            .map(|name| SchemaInfo { name })
            .collect())
    }
    async fn list_tables(&self, schema: &SchemaRef) -> Result<Vec<TableInfo>, DbError> {
        introspect::list_tables(&self.pool, Self::schema_of(schema)).await
    }
    async fn list_views(&self, schema: &SchemaRef) -> Result<Vec<TableInfo>, DbError> {
        introspect::list_views(&self.pool, Self::schema_of(schema)).await
    }
    async fn list_functions(&self, schema: &SchemaRef) -> Result<Vec<FunctionInfo>, DbError> {
        introspect::list_functions(&self.pool, Self::schema_of(schema)).await
    }
    async fn get_columns(&self, table: &TableRef) -> Result<Vec<ColumnInfo>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        introspect::get_columns(&self.pool, schema, &table.table).await
    }
    async fn get_indexes(&self, table: &TableRef) -> Result<Vec<IndexInfo>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        introspect::get_indexes(&self.pool, schema, &table.table).await
    }
    async fn get_constraints(&self, _table: &TableRef) -> Result<Vec<ConstraintInfo>, DbError> {
        // CHECK/UNIQUE constraint introspection deferred; primary keys are exposed
        // via ColumnInfo.is_primary_key and foreign keys via get_foreign_keys.
        Ok(vec![])
    }
    async fn get_foreign_keys(&self, table: &TableRef) -> Result<Vec<ForeignKeyInfo>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        introspect::get_foreign_keys(&self.pool, schema, &table.table).await
    }
    async fn get_triggers(&self, table: &TableRef) -> Result<Vec<TriggerInfo>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        introspect::get_triggers(&self.pool, schema, &table.table).await
    }
    async fn get_table_ddl(&self, table: &TableRef) -> Result<String, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        introspect::get_table_ddl(&self.pool, schema, &table.table).await
    }
    async fn estimated_row_count(&self, table: &TableRef) -> Result<Option<i64>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        introspect::estimated_row_count(&self.pool, schema, &table.table).await
    }

    async fn fetch_rows(&self, table: &TableRef, opts: FetchOptions) -> Result<RowPage, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        let mut idx = 0;
        let where_clause = filter::build_where(
            &opts.filters,
            filter::Dialect {
                quote: quote_ident,
                placeholder: || {
                    idx += 1;
                    format!("${idx}")
                },
                cast_text: |col: &str| format!("{col}::text"),
                like: "ILIKE",
            },
        );
        let order = filter::order_clause(opts.order_by.as_ref(), opts.order_desc, quote_ident);
        let query = format!(
            "SELECT * FROM {}{}{} LIMIT ${} OFFSET ${}",
            quote_qualified(schema, &table.table),
            where_clause.sql,
            order,
            idx + 1,
            idx + 2
        );

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

        let (first_page_rows, has_more) =
            split_page(&cached.rows, QUERY_PAGE_SIZE);
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
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        mutate::insert_row(&self.pool, schema, &table.table, values).await
    }
    async fn update_row(
        &self,
        table: &TableRef,
        pk: &HashMap<String, DbValue>,
        changes: &HashMap<String, DbValue>,
    ) -> Result<String, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        mutate::update_row(&self.pool, schema, &table.table, pk, changes).await
    }
    async fn delete_rows(
        &self,
        table: &TableRef,
        pks: &[HashMap<String, DbValue>],
    ) -> Result<Vec<String>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        mutate::delete_rows(&self.pool, schema, &table.table, pks).await
    }

    async fn build_create_table_ddl(&self, spec: &TableSpec) -> Result<Vec<String>, DbError> {
        ddl::build_create_table_ddl(DEFAULT_SCHEMA, spec)
    }
    async fn build_alter_table_ddl(
        &self,
        table: &TableRef,
        diff: &TableDiff,
    ) -> Result<Vec<String>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        ddl::build_alter_table_ddl(schema, &table.table, diff)
    }
    async fn build_drop_table_ddl(&self, table: &TableRef) -> Result<Vec<String>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        Ok(ddl::build_drop_table_ddl(schema, &table.table))
    }
    async fn build_truncate_table_ddl(&self, table: &TableRef) -> Result<Vec<String>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        Ok(ddl::build_truncate_table_ddl(schema, &table.table))
    }
    async fn build_edit_column_ddl(
        &self,
        table: &TableRef,
        column: &str,
        new_type: Option<&str>,
        nullable: Option<bool>,
        default: Option<Option<String>>,
    ) -> Result<Vec<String>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        ddl::build_edit_column_ddl(
            schema,
            &table.table,
            column,
            new_type,
            nullable,
            default.as_ref().map(|d| d.as_deref()),
        )
    }
    async fn build_create_index_ddl(
        &self,
        table: &TableRef,
        index_name: &str,
        unique: bool,
        columns: &[String],
    ) -> Result<Vec<String>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        Ok(vec![ddl::build_create_index_ddl(
            schema,
            &table.table,
            index_name,
            unique,
            columns,
        )])
    }
    async fn build_drop_index_ddl(&self, table: &TableRef, index_name: &str) -> Result<Vec<String>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        Ok(vec![ddl::build_drop_index_ddl(schema, index_name)])
    }
    async fn execute_ddl(&self, statements: &[String]) -> Result<(), DbError> {
        ddl::execute_ddl(&self.pool, statements).await
    }
}
