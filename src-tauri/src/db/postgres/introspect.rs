use sqlx::{PgPool, Row};

use crate::db::error::DbError;
use crate::db::types::{ColumnInfo, ForeignKeyInfo, FunctionInfo, IndexInfo, TableInfo, TriggerInfo};

/// Double-embedded quotes to safely inline an identifier where sqlx can't bind
/// one (schema/table names in FROM clauses don't accept bind params).
pub fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

pub fn quote_qualified(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(table))
}

pub async fn list_databases(pool: &PgPool) -> Result<Vec<String>, DbError> {
    let rows = sqlx::query("SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY datname")
        .fetch_all(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
    Ok(rows.into_iter().map(|r| r.get::<String, _>("datname")).collect())
}

pub async fn list_schemas(pool: &PgPool) -> Result<Vec<String>, DbError> {
    let rows = sqlx::query(
        "SELECT schema_name FROM information_schema.schemata \
         WHERE schema_name NOT IN ('pg_catalog', 'information_schema') \
         AND schema_name NOT LIKE 'pg_toast%' AND schema_name NOT LIKE 'pg_temp_%' \
         ORDER BY schema_name",
    )
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;
    Ok(rows.into_iter().map(|r| r.get::<String, _>("schema_name")).collect())
}

async fn list_by_type(pool: &PgPool, schema: &str, table_type: &str, is_view: bool) -> Result<Vec<TableInfo>, DbError> {
    let rows = sqlx::query(
        "SELECT table_name FROM information_schema.tables \
         WHERE table_schema = $1 AND table_type = $2 ORDER BY table_name",
    )
    .bind(schema)
    .bind(table_type)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| TableInfo {
            name: row.get::<String, _>("table_name"),
            is_view,
            estimated_row_count: None,
        })
        .collect())
}

pub async fn list_tables(pool: &PgPool, schema: &str) -> Result<Vec<TableInfo>, DbError> {
    list_by_type(pool, schema, "BASE TABLE", false).await
}

pub async fn list_views(pool: &PgPool, schema: &str) -> Result<Vec<TableInfo>, DbError> {
    list_by_type(pool, schema, "VIEW", true).await
}

pub async fn list_functions(pool: &PgPool, schema: &str) -> Result<Vec<FunctionInfo>, DbError> {
    let rows = sqlx::query(
        // prokind filters out aggregates and window functions, which aren't
        // callable in the way the sidebar implies.
        "SELECT p.proname AS name, \
                pg_get_function_identity_arguments(p.oid) AS arguments, \
                pg_get_function_result(p.oid) AS returns, \
                CASE p.prokind WHEN 'p' THEN 'procedure' ELSE 'function' END AS kind \
         FROM pg_proc p \
         JOIN pg_namespace n ON n.oid = p.pronamespace \
         WHERE n.nspname = $1 AND p.prokind IN ('f', 'p') \
         ORDER BY p.proname",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| FunctionInfo {
            name: row.get::<String, _>("name"),
            arguments: row.try_get::<String, _>("arguments").unwrap_or_default(),
            returns: row.try_get::<String, _>("returns").unwrap_or_default(),
            kind: row.get::<String, _>("kind"),
        })
        .collect())
}

pub async fn get_columns(pool: &PgPool, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, DbError> {
    let rows = sqlx::query(
        // pg_catalog rather than information_schema: the latter's views are filtered by
        // privilege and its constraint joins are fragile, which silently produced
        // is_primary_key = false and made every table read-only in the grid.
        "SELECT a.attname AS column_name, \
                format_type(a.atttypid, a.atttypmod) AS data_type, \
                NOT a.attnotnull AS nullable, \
                pg_get_expr(d.adbin, d.adrelid) AS column_default, \
                COALESCE(i.indisprimary, false) AS is_primary_key, \
                COALESCE(e.labels, ARRAY[]::text[]) AS enum_values \
         FROM pg_attribute a \
         JOIN pg_class c ON c.oid = a.attrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum \
         LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey) \
         LEFT JOIN LATERAL ( \
           SELECT array_agg(en.enumlabel::text ORDER BY en.enumsortorder) AS labels \
           FROM pg_enum en WHERE en.enumtypid = a.atttypid \
         ) e ON true \
         WHERE n.nspname = $1 AND c.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped \
         ORDER BY a.attnum",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| ColumnInfo {
            name: row.get::<String, _>("column_name"),
            data_type: row.get::<String, _>("data_type"),
            nullable: row.get::<bool, _>("nullable"),
            is_primary_key: row.get::<bool, _>("is_primary_key"),
            default_value: row.try_get::<String, _>("column_default").ok(),
            enum_values: row.try_get::<Vec<String>, _>("enum_values").unwrap_or_default(),
        })
        .collect())
}

pub async fn get_indexes(pool: &PgPool, schema: &str, table: &str) -> Result<Vec<IndexInfo>, DbError> {
    let rows = sqlx::query(
        "SELECT i.relname AS index_name, ix.indisunique AS is_unique, \
                array_agg(a.attname ORDER BY array_position(ix.indkey, a.attnum)) AS columns \
         FROM pg_class t \
         JOIN pg_namespace n ON n.oid = t.relnamespace \
         JOIN pg_index ix ON ix.indrelid = t.oid \
         JOIN pg_class i ON i.oid = ix.indexrelid \
         JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey) \
         WHERE n.nspname = $1 AND t.relname = $2 \
         GROUP BY i.relname, ix.indisunique \
         ORDER BY i.relname",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| IndexInfo {
            name: row.get::<String, _>("index_name"),
            columns: row.get::<Vec<String>, _>("columns"),
            is_unique: row.get::<bool, _>("is_unique"),
        })
        .collect())
}

pub async fn get_foreign_keys(pool: &PgPool, schema: &str, table: &str) -> Result<Vec<ForeignKeyInfo>, DbError> {
    let rows = sqlx::query(
        "SELECT tc.constraint_name, kcu.column_name, ccu.table_name AS referenced_table, \
                ccu.column_name AS referenced_column \
         FROM information_schema.table_constraints tc \
         JOIN information_schema.key_column_usage kcu \
           ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema \
         JOIN information_schema.constraint_column_usage ccu \
           ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema \
         WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = $1 AND tc.table_name = $2",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| ForeignKeyInfo {
            name: row.get::<String, _>("constraint_name"),
            columns: vec![row.get::<String, _>("column_name")],
            referenced_table: row.get::<String, _>("referenced_table"),
            referenced_columns: vec![row.get::<String, _>("referenced_column")],
        })
        .collect())
}

pub async fn get_triggers(pool: &PgPool, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, DbError> {
    let rows = sqlx::query(
        "SELECT t.tgname AS name, \
                pg_get_triggerdef(t.oid) AS statement, \
                CASE WHEN (t.tgtype & 2) <> 0 THEN 'BEFORE' ELSE 'AFTER' END AS timing, \
                CASE WHEN (t.tgtype & 4) <> 0 THEN 'INSERT' \
                     WHEN (t.tgtype & 8) <> 0 THEN 'DELETE' \
                     WHEN (t.tgtype & 16) <> 0 THEN 'UPDATE' \
                     ELSE 'TRUNCATE' END AS event \
         FROM pg_trigger t \
         JOIN pg_class c ON c.oid = t.tgrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         WHERE n.nspname = $1 AND c.relname = $2 AND NOT t.tgisinternal \
         ORDER BY t.tgname",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| TriggerInfo {
            name: row.get::<String, _>("name"),
            timing: row.get::<String, _>("timing"),
            event: row.get::<String, _>("event"),
            statement: row.try_get::<String, _>("statement").unwrap_or_default(),
        })
        .collect())
}

/// Postgres has no SHOW CREATE TABLE, so the statement is reconstructed from the
/// catalog. It's a faithful summary rather than a byte-exact dump.
pub async fn get_table_ddl(pool: &PgPool, schema: &str, table: &str) -> Result<String, DbError> {
    let columns = get_columns(pool, schema, table).await?;
    if columns.is_empty() {
        return Err(DbError::Query(format!("table {schema}.{table} not found")));
    }

    let mut lines: Vec<String> = columns
        .iter()
        .map(|c| {
            let mut line = format!("  {} {}", quote_ident(&c.name), c.data_type);
            if !c.nullable {
                line.push_str(" NOT NULL");
            }
            if let Some(default) = &c.default_value {
                line.push_str(&format!(" DEFAULT {default}"));
            }
            line
        })
        .collect();

    let pk: Vec<String> = columns
        .iter()
        .filter(|c| c.is_primary_key)
        .map(|c| quote_ident(&c.name))
        .collect();
    if !pk.is_empty() {
        lines.push(format!("  PRIMARY KEY ({})", pk.join(", ")));
    }
    for fk in get_foreign_keys(pool, schema, table).await? {
        lines.push(format!(
            "  CONSTRAINT {} FOREIGN KEY ({}) REFERENCES {} ({})",
            quote_ident(&fk.name),
            fk.columns.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", "),
            quote_ident(&fk.referenced_table),
            fk.referenced_columns.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", "),
        ));
    }

    let mut ddl = format!(
        "CREATE TABLE {} (\n{}\n);",
        quote_qualified(schema, table),
        lines.join(",\n")
    );
    for idx in get_indexes(pool, schema, table).await? {
        if pk.len() == idx.columns.len() && idx.name.ends_with("_pkey") {
            continue;
        }
        ddl.push_str(&format!(
            "\n\nCREATE {}INDEX {} ON {} ({});",
            if idx.is_unique { "UNIQUE " } else { "" },
            quote_ident(&idx.name),
            quote_qualified(schema, table),
            idx.columns.iter().map(|c| quote_ident(c)).collect::<Vec<_>>().join(", "),
        ));
    }
    Ok(ddl)
}

pub async fn estimated_row_count(pool: &PgPool, schema: &str, table: &str) -> Result<Option<i64>, DbError> {
    let qualified = format!("{}.{}", schema, table);
    let row = sqlx::query("SELECT reltuples::bigint AS c FROM pg_class WHERE oid = to_regclass($1)")
        .bind(qualified)
        .fetch_optional(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
    Ok(row.and_then(|r| r.try_get::<i64, _>("c").ok()))
}
