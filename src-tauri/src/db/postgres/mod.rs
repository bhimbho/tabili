mod ddl;
mod decode;
mod introspect;
mod mutate;

use async_trait::async_trait;
use sqlx::postgres::PgSslMode;
use std::collections::HashMap;
use std::str::FromStr;

use crate::db::{
    ColumnInfo, ConnectionConfig, ConstraintInfo, DatabaseDriver, DatabaseInfo, DbError, DbValue,
    FetchOptions, ForeignKeyInfo, IndexInfo, QueryExecutionId, QueryHandle, RowPage, SchemaInfo,
    SchemaRef, SqlDialect, TableDiff, TableInfo, TableRef, TableSpec,
};
use introspect::{quote_ident, quote_qualified};

const DEFAULT_SCHEMA: &str = "public";

pub struct PostgresDriver {
    pool: sqlx::PgPool,
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
        if let Some(ca) = &config.ssl_ca_path {
            opts = opts.ssl_root_cert(ca);
        }
        if let Some(cert) = &config.ssl_cert_path {
            opts = opts.ssl_client_cert(cert);
        }
        if let Some(key) = &config.ssl_key_path {
            opts = opts.ssl_client_key(key);
        }

        let pool = sqlx::postgres::PgPoolOptions::new()
            .max_connections(config.max_connections.max(1))
            .connect_with(opts)
            .await
            .map_err(|e| DbError::Connection(e.to_string()))?;
        Ok(Self { pool })
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

    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, DbError> {
        Ok(introspect::list_databases(&self.pool)
            .await?
            .into_iter()
            .map(|name| DatabaseInfo { name })
            .collect())
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
    async fn estimated_row_count(&self, table: &TableRef) -> Result<Option<i64>, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        introspect::estimated_row_count(&self.pool, schema, &table.table).await
    }

    async fn fetch_rows(&self, table: &TableRef, opts: FetchOptions) -> Result<RowPage, DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        let order_clause = opts
            .order_by
            .as_ref()
            .map(|c| format!(" ORDER BY {}", quote_ident(c)))
            .unwrap_or_default();
        let query = format!(
            "SELECT * FROM {}{} LIMIT $1 OFFSET $2",
            quote_qualified(schema, &table.table),
            order_clause
        );

        let fetch_limit = opts.limit as i64 + 1;
        let rows = sqlx::query(sqlx::AssertSqlSafe(query))
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

        Ok(RowPage { columns, rows: out_rows, has_more })
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
    ) -> Result<(), DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        mutate::insert_row(&self.pool, schema, &table.table, values).await
    }
    async fn update_row(
        &self,
        table: &TableRef,
        pk: &HashMap<String, DbValue>,
        changes: &HashMap<String, DbValue>,
    ) -> Result<(), DbError> {
        let schema = table.schema.as_deref().unwrap_or(DEFAULT_SCHEMA);
        mutate::update_row(&self.pool, schema, &table.table, pk, changes).await
    }
    async fn delete_rows(
        &self,
        table: &TableRef,
        pks: &[HashMap<String, DbValue>],
    ) -> Result<(), DbError> {
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
    async fn execute_ddl(&self, statements: &[String]) -> Result<(), DbError> {
        ddl::execute_ddl(&self.pool, statements).await
    }
}
