mod decode;
mod ddl;
mod introspect;
mod mutate;

use async_trait::async_trait;
use sqlx::Row;
use std::collections::HashMap;
use std::sync::Mutex;

use crate::db::{
    filter, split_page, ColumnInfo, ConnectionConfig, ConstraintInfo, DatabaseDriver, DatabaseInfo,
    DbError, DbValue, FetchOptions, ForeignKeyInfo, FunctionInfo, IndexInfo, QueryExecutionId,
    QueryHandle, RowPage, SchemaInfo, SchemaRef, ServerInfo, SqlDialect, TableDiff, TableInfo,
    TableRef, TableSpec, TriggerInfo, DbUser, DbGrant,
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

pub struct MySqlDriver {
    pool: sqlx::MySqlPool,
    /// The database selected at connect time — MySQL has no schema distinct
    /// from database, so this doubles as the default schema.
    default_database: Option<String>,
    query_cache: Mutex<HashMap<String, CachedResult>>,
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
            // Reconnect fast: give up acquiring a replacement in seconds rather
            // than queueing behind a dead pool, recycle stale idle connections,
            // and re-validate every borrow so a dropped tunnel surfaces as an
            // error instead of a hang.
            .acquire_timeout(std::time::Duration::from_secs(10))
            .idle_timeout(std::time::Duration::from_secs(300))
            .max_lifetime(std::time::Duration::from_secs(1800))
            .test_before_acquire(true)
            .connect_with(opts)
            .await
            .map_err(|e| DbError::Connection(e.to_string()))?;
        Ok(Self {
            pool,
            default_database: config.database.clone(),
            query_cache: Mutex::new(HashMap::new()),
        })
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
    async fn create_database(&self, name: &str) -> Result<(), DbError> {
        let clean = name.trim();
        let quoted = introspect::quote_ident(clean);
        sqlx::query(sqlx::AssertSqlSafe(format!("CREATE DATABASE {quoted}")))
            .execute(&self.pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(())
    }
    async fn drop_database(&self, name: &str) -> Result<(), DbError> {
        let clean = name.trim();
        let quoted = introspect::quote_ident(clean);
        sqlx::query(sqlx::AssertSqlSafe(format!("DROP DATABASE {quoted}")))
            .execute(&self.pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(())
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
    async fn build_truncate_table_ddl(&self, table: &TableRef) -> Result<Vec<String>, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
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
        let schema = self.resolve_schema(table.schema.as_deref())?;
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
        let schema = self.resolve_schema(table.schema.as_deref())?;
        Ok(vec![ddl::build_create_index_ddl(
            schema,
            &table.table,
            index_name,
            unique,
            columns,
        )])
    }
    async fn build_drop_index_ddl(&self, table: &TableRef, index_name: &str) -> Result<Vec<String>, DbError> {
        let schema = self.resolve_schema(table.schema.as_deref())?;
        Ok(vec![ddl::build_drop_index_ddl(schema, &table.table, index_name)])
    }
    async fn execute_ddl(&self, statements: &[String]) -> Result<(), DbError> {
        ddl::execute_ddl(&self.pool, statements).await
    }
    // --- user management ---
    async fn list_users(&self) -> Result<Vec<DbUser>, DbError> {
        let rows = sqlx::query(
            r#"SELECT user AS name,
                       host,
                       Super_priv = 'Y' AS superuser,
                       Create_priv = 'Y' AS create_db,
                       Create_user_priv = 'Y' AS create_role,
                       1 AS can_login
                FROM mysql.user"#,
        )
        .fetch_all(&self.pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
        let mut users = Vec::with_capacity(rows.len());
        for row in rows {
            users.push(DbUser {
                name: row.get("name"),
                host: row.try_get("host").ok(),
                superuser: row.get("superuser"),
                can_create_db: row.get("create_db"),
                can_create_role: row.get("create_role"),
                can_login: row.get("can_login"),
            });
        }
        Ok(users)
    }
    async fn create_user(
        &self,
        name: &str,
        password: &str,
        host: Option<&str>,
        _superuser: bool,
    ) -> Result<(), DbError> {
        let quoted = quote_ident(name);
        let h = host.unwrap_or("%");
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "CREATE USER {quoted}@'{h}' IDENTIFIED BY '{password}'"
        )))
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(())
    }
    async fn drop_user(&self, name: &str, host: Option<&str>) -> Result<(), DbError> {
        let quoted = quote_ident(name);
        let h = host.unwrap_or("%");
        sqlx::query(sqlx::AssertSqlSafe(format!("DROP USER {quoted}@'{h}'")))
            .execute(&self.pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(())
    }
    async fn alter_user_password(
        &self,
        name: &str,
        host: Option<&str>,
        new_password: &str,
    ) -> Result<(), DbError> {
        let quoted = quote_ident(name);
        let h = host.unwrap_or("%");
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "ALTER USER {quoted}@'{h}' IDENTIFIED BY '{new_password}'"
        )))
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(())
    }
    async fn user_grants(&self, name: &str, host: Option<&str>) -> Result<Vec<DbGrant>, DbError> {
        let h = host.unwrap_or("%");
        let rows = sqlx::query("SHOW GRANTS FOR ?@?")
            .bind(name)
            .bind(h)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;
        let mut grants = Vec::with_capacity(rows.len());
        for row in rows {
            let raw: String = row.get(0);
            // rough parse: "GRANT priv[, priv] ON `db`.`tbl` TO ..."
            if let Some(rest) = raw.strip_prefix("GRANT ") {
                let parts: Vec<&str> = rest.split(" ON ").collect();
                if parts.len() == 2 {
                    let privs = parts[0];
                    let obj = parts[1].split(" TO ").next().unwrap_or(parts[1]);
                    for p in privs.split(", ") {
                        let mut schema = None;
                        let mut table = None;
                        if obj.contains(".") {
                            let o: Vec<&str> = obj.split(".").collect();
                            schema = Some(o[0].trim_matches('`').to_string());
                            table = Some(o[1].trim_matches('`').to_string());
                        }
                        grants.push(DbGrant {
                            privilege: p.to_string(),
                            schema,
                            table,
                        });
                    }
                }
            }
        }
        Ok(grants)
    }
    async fn grant_privilege(
        &self,
        name: &str,
        host: Option<&str>,
        privilege: &str,
        schema: Option<&str>,
        table: Option<&str>,
    ) -> Result<(), DbError> {
        let quoted = quote_ident(name);
        let h = host.unwrap_or("%");
        let obj = match (schema, table) {
            (Some(s), Some(t)) => format!("{}.{}.*", quote_ident(s), quote_ident(t)),
            (Some(s), None) => format!("{}.*", quote_ident(s)),
            (None, Some(t)) => format!("*.{}", quote_ident(t)),
            (None, None) => "*.*".to_string(),
        };
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "GRANT {privilege} ON {obj} TO {quoted}@'{h}'"
        )))
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(())
    }
    async fn revoke_privilege(
        &self,
        name: &str,
        host: Option<&str>,
        privilege: &str,
        schema: Option<&str>,
        table: Option<&str>,
    ) -> Result<(), DbError> {
        let quoted = quote_ident(name);
        let h = host.unwrap_or("%");
        let obj = match (schema, table) {
            (Some(s), Some(t)) => format!("{}.{}.*", quote_ident(s), quote_ident(t)),
            (Some(s), None) => format!("{}.*", quote_ident(s)),
            (None, Some(t)) => format!("*.{}", quote_ident(t)),
            (None, None) => "*.*".to_string(),
        };
        sqlx::query(sqlx::AssertSqlSafe(format!(
            "REVOKE {privilege} ON {obj} FROM {quoted}@'{h}'"
        )))
        .execute(&self.pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
        Ok(())
    }
}
