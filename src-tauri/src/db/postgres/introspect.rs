use sqlx::{PgPool, Row};

use crate::db::error::DbError;
use crate::db::types::{ColumnInfo, ForeignKeyInfo, IndexInfo, TableInfo};

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

pub async fn get_columns(pool: &PgPool, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, DbError> {
    let rows = sqlx::query(
        // pg_catalog rather than information_schema: the latter's views are filtered by
        // privilege and its constraint joins are fragile, which silently produced
        // is_primary_key = false and made every table read-only in the grid.
        "SELECT a.attname AS column_name, \
                format_type(a.atttypid, a.atttypmod) AS data_type, \
                NOT a.attnotnull AS nullable, \
                pg_get_expr(d.adbin, d.adrelid) AS column_default, \
                COALESCE(i.indisprimary, false) AS is_primary_key \
         FROM pg_attribute a \
         JOIN pg_class c ON c.oid = a.attrelid \
         JOIN pg_namespace n ON n.oid = c.relnamespace \
         LEFT JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum \
         LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY(i.indkey) \
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

pub async fn estimated_row_count(pool: &PgPool, schema: &str, table: &str) -> Result<Option<i64>, DbError> {
    let qualified = format!("{}.{}", schema, table);
    let row = sqlx::query("SELECT reltuples::bigint AS c FROM pg_class WHERE oid = to_regclass($1)")
        .bind(qualified)
        .fetch_optional(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
    Ok(row.and_then(|r| r.try_get::<i64, _>("c").ok()))
}
