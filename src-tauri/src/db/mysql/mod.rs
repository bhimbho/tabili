mod decode;
mod ddl;
mod introspect;
mod mutate;

use async_trait::async_trait;
use sqlx::Row;
use std::collections::HashMap;

use crate::db::{
    filter, ColumnInfo, ConnectionConfig, ConstraintInfo, DatabaseDriver, DatabaseInfo, DbError,
    DbValue, FetchOptions, ForeignKeyInfo, FunctionInfo, IndexInfo, QueryExecutionId, QueryHandle,
    RowPage, SchemaInfo, SchemaRef, ServerInfo, SqlDialect, TableDiff, TableInfo, TableRef,
    TableSpec, TriggerInfo,
};
use introspect::quote_ident;

pub struct MySqlDriver {
    pool: sqlx::MySqlPool,
    /// The database selected at connect time — MySQL has no schema distinct
    /// from database, so this doubles as the default schema.
    default_database: Option<String>,
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
        if let Some(ca) = config.ssl_ca_path.as_deref().filter(|p| !p.is_empty()) {
            opts = opts.ssl_ca(ca);
        }
        if let Some(cert) = config.ssl_cert_path.as_deref().filter(|p| !p.is_empty()) {
            opts = opts.ssl_client_cert(cert);
        }
        if let Some(key) = config.ssl_key_path.as_deref().filter(|p| !p.is_empty()) {
            opts = opts.ssl_client_key(key);
        }
        let pool = sqlx::mysql::MySqlPoolOptions::new()
            .max_connections(config.max_connections.max(1))
            .connect_with(opts)
            .await
            .map_err(|e| DbError::Connection(e.to_string()))?;
        Ok(Self { pool, default_database: config.database.clone() })
    }

    fn resolve_schema<'a>(&'a self, schema: Option<&'a str>) -> Result<&'a str, DbError> {
        schema
            .or(self.default_database.as_deref())
            .ok_or_else(|| DbError::Query("no database selected".into()))
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
        let row = sqlx::query("SELECT VERSION() AS v, DATABASE() AS d")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(ServerInfo {
            version: format!("MySQL {}", row.get::<String, _>("v")),
            database: row.try_get::<String, _>("d").unwrap_or_default(),
        })
    }

    async fn list_databases(&self) -> Result<Vec<DatabaseInfo>, DbError> {
        Ok(introspect::list_databases(&self.pool)
            .await?
            .into_iter()
            .map(|name| DatabaseInfo { name })
            .collect())
    }
    async fn list_schemas(&self, _database: Option<&str>) -> Result<Vec<SchemaInfo>, DbError> {
        // Schema == database in MySQL, so this mirrors list_databases.
        Ok(introspect::list_databases(&self.pool)
            .await?
            .into_iter()
            .map(|name| SchemaInfo { name })
            .collect())
    }
    async fn list_tables(&self, schema: &SchemaRef) -> Result<Vec<TableInfo>, DbError> {
        introspect::list_tables(&self.pool, self.resolve_schema(schema.schema.as_deref())?).await
    }
    async fn list_views(&self, schema: &SchemaRef) -> Result<Vec<TableInfo>, DbError> {
        introspect::list_views(&self.pool, self.resolve_schema(schema.schema.as_deref())?).await
    }
    async fn list_functions(&self, schema: &SchemaRef) -> Result<Vec<FunctionInfo>, DbError> {
        introspect::list_functions(&self.pool, self.resolve_schema(schema.schema.as_deref())?)
            .await
    }
    async fn get_columns(&self, table: &TableRef) -> Result<Vec<ColumnInfo>, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        introspect::get_columns(&self.pool, schema, &table.table).await
    }
    async fn get_indexes(&self, table: &TableRef) -> Result<Vec<IndexInfo>, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        introspect::get_indexes(&self.pool, schema, &table.table).await
    }
    async fn get_constraints(&self, _table: &TableRef) -> Result<Vec<ConstraintInfo>, DbError> {
        // CHECK/UNIQUE constraint introspection deferred; primary keys are exposed
        // via ColumnInfo.is_primary_key and foreign keys via get_foreign_keys.
        Ok(vec![])
    }
    async fn get_foreign_keys(&self, table: &TableRef) -> Result<Vec<ForeignKeyInfo>, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        introspect::get_foreign_keys(&self.pool, schema, &table.table).await
    }
    async fn get_triggers(&self, table: &TableRef) -> Result<Vec<TriggerInfo>, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        introspect::get_triggers(&self.pool, schema, &table.table).await
    }
    async fn get_table_ddl(&self, table: &TableRef) -> Result<String, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        introspect::get_table_ddl(&self.pool, schema, &table.table).await
    }
    async fn estimated_row_count(&self, table: &TableRef) -> Result<Option<i64>, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        introspect::estimated_row_count(&self.pool, schema, &table.table).await
    }

    async fn fetch_rows(&self, table: &TableRef, opts: FetchOptions) -> Result<RowPage, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        let where_clause = filter::build_where(
            &opts.filters,
            filter::Dialect {
                quote: quote_ident,
                placeholder: || "?".to_string(),
                cast_text: |col: &str| format!("CAST({col} AS CHAR)"),
                like: "LIKE",
            },
        );
        let order = filter::order_clause(opts.order_by.as_ref(), opts.order_desc, quote_ident);
        let query = format!(
            "SELECT * FROM {}{}{} LIMIT ? OFFSET ?",
            introspect::quote_qualified(schema, &table.table),
            where_clause.sql,
            order
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
        let schema = self.resolve_schema(table.schema.as_deref())?;
        mutate::insert_row(&self.pool, schema, &table.table, values).await
    }
    async fn update_row(
        &self,
        table: &TableRef,
        pk: &HashMap<String, DbValue>,
        changes: &HashMap<String, DbValue>,
    ) -> Result<String, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        mutate::update_row(&self.pool, schema, &table.table, pk, changes).await
    }
    async fn delete_rows(
        &self,
        table: &TableRef,
        pks: &[HashMap<String, DbValue>],
    ) -> Result<Vec<String>, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        mutate::delete_rows(&self.pool, schema, &table.table, pks).await
    }

    async fn build_create_table_ddl(&self, spec: &TableSpec) -> Result<Vec<String>, DbError> {
        let schema = self.resolve_schema(None)?;
        ddl::build_create_table_ddl(schema, spec)
    }
    async fn build_alter_table_ddl(
        &self,
        table: &TableRef,
        diff: &TableDiff,
    ) -> Result<Vec<String>, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        ddl::build_alter_table_ddl(schema, &table.table, diff)
    }
    async fn build_drop_table_ddl(&self, table: &TableRef) -> Result<Vec<String>, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        Ok(ddl::build_drop_table_ddl(schema, &table.table))
    }
    async fn execute_ddl(&self, statements: &[String]) -> Result<(), DbError> {
        ddl::execute_ddl(&self.pool, statements).await
    }
}
