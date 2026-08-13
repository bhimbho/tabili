use sqlx::{MySqlPool, Row};

use crate::db::error::DbError;
use crate::db::types::{ColumnInfo, ForeignKeyInfo, FunctionInfo, IndexInfo, TableInfo, TriggerInfo};

/// Backtick-quotes an identifier — MySQL's escape for embedded backticks is
/// doubling them, same idea as the double-quote escaping used elsewhere.
pub fn quote_ident(ident: &str) -> String {
    format!("`{}`", ident.replace('`', "``"))
}

pub fn quote_qualified(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(table))
}

const SYSTEM_SCHEMAS: [&str; 4] = ["information_schema", "mysql", "performance_schema", "sys"];

/// MySQL has no Postgres-style schema nested inside a database — a "database"
/// and a "schema" are the same object, so both list_databases and list_schemas
/// return this.
pub async fn list_databases(pool: &MySqlPool) -> Result<Vec<String>, DbError> {
    let rows = sqlx::query("SHOW DATABASES")
        .fetch_all(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
    Ok(rows
        .into_iter()
        .map(|r| r.get::<String, _>(0))
        .filter(|name| !SYSTEM_SCHEMAS.contains(&name.as_str()))
        .collect())
}

async fn list_by_type(pool: &MySqlPool, schema: &str, table_type: &str, is_view: bool) -> Result<Vec<TableInfo>, DbError> {
    let rows = sqlx::query(
        "SELECT TABLE_NAME FROM information_schema.TABLES \
         WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = ? ORDER BY TABLE_NAME",
    )
    .bind(schema)
    .bind(table_type)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| TableInfo {
            name: row.get::<String, _>("TABLE_NAME"),
            is_view,
            estimated_row_count: None,
        })
        .collect())
}

pub async fn list_tables(pool: &MySqlPool, schema: &str) -> Result<Vec<TableInfo>, DbError> {
    list_by_type(pool, schema, "BASE TABLE", false).await
}

pub async fn list_views(pool: &MySqlPool, schema: &str) -> Result<Vec<TableInfo>, DbError> {
    list_by_type(pool, schema, "VIEW", true).await
}

pub async fn list_functions(pool: &MySqlPool, schema: &str) -> Result<Vec<FunctionInfo>, DbError> {
    let rows = sqlx::query(
        "SELECT r.ROUTINE_NAME AS name, r.ROUTINE_TYPE AS kind, \
                COALESCE(r.DTD_IDENTIFIER, '') AS returns, \
                COALESCE(( \
                  SELECT GROUP_CONCAT(CONCAT(p.PARAMETER_NAME, ' ', p.DTD_IDENTIFIER) \
                                       ORDER BY p.ORDINAL_POSITION SEPARATOR ', ') \
                  FROM information_schema.PARAMETERS p \
                  WHERE p.SPECIFIC_SCHEMA = r.ROUTINE_SCHEMA AND p.SPECIFIC_NAME = r.ROUTINE_NAME \
                    AND p.PARAMETER_MODE IS NOT NULL \
                ), '') AS arguments \
         FROM information_schema.ROUTINES r \
         WHERE r.ROUTINE_SCHEMA = ? \
         ORDER BY r.ROUTINE_NAME",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| FunctionInfo {
            name: row.get::<String, _>("name"),
            arguments: row.get::<String, _>("arguments"),
            returns: row.get::<String, _>("returns"),
            kind: if row.get::<String, _>("kind") == "PROCEDURE" { "procedure" } else { "function" }
                .to_string(),
        })
        .collect())
}

pub async fn get_columns(pool: &MySqlPool, schema: &str, table: &str) -> Result<Vec<ColumnInfo>, DbError> {
    let rows = sqlx::query(
        "SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, COLUMN_KEY \
         FROM information_schema.COLUMNS \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| ColumnInfo {
            name: row.get::<String, _>("COLUMN_NAME"),
            data_type: row.get::<String, _>("COLUMN_TYPE"),
            nullable: row.get::<String, _>("IS_NULLABLE") == "YES",
            is_primary_key: row.get::<String, _>("COLUMN_KEY") == "PRI",
            default_value: row.try_get::<String, _>("COLUMN_DEFAULT").ok(),
        })
        .collect())
}

/// `SHOW INDEX` can't be parameterised — the identifiers are already validated
/// via quote_qualified, same pattern as PRAGMA statements elsewhere.
pub async fn get_indexes(pool: &MySqlPool, schema: &str, table: &str) -> Result<Vec<IndexInfo>, DbError> {
    let query = format!("SHOW INDEX FROM {}", quote_qualified(schema, table));
    let rows = sqlx::query(sqlx::AssertSqlSafe(query))
        .fetch_all(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;

    let mut indexes: Vec<IndexInfo> = Vec::new();
    for row in rows {
        let name: String = row.get("Key_name");
        let column: String = row.get("Column_name");
        let non_unique: i64 = row.get("Non_unique");
        match indexes.iter_mut().find(|i| i.name == name) {
            Some(existing) => existing.columns.push(column),
            None => indexes.push(IndexInfo { name, columns: vec![column], is_unique: non_unique == 0 }),
        }
    }
    Ok(indexes)
}

pub async fn get_foreign_keys(pool: &MySqlPool, schema: &str, table: &str) -> Result<Vec<ForeignKeyInfo>, DbError> {
    let rows = sqlx::query(
        "SELECT CONSTRAINT_NAME, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME \
         FROM information_schema.KEY_COLUMN_USAGE \
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND REFERENCED_TABLE_NAME IS NOT NULL",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| ForeignKeyInfo {
            name: row.get::<String, _>("CONSTRAINT_NAME"),
            columns: vec![row.get::<String, _>("COLUMN_NAME")],
            referenced_table: row.get::<String, _>("REFERENCED_TABLE_NAME"),
            referenced_columns: vec![row.get::<String, _>("REFERENCED_COLUMN_NAME")],
        })
        .collect())
}

pub async fn get_triggers(pool: &MySqlPool, schema: &str, table: &str) -> Result<Vec<TriggerInfo>, DbError> {
    let rows = sqlx::query(
        "SELECT TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT \
         FROM information_schema.TRIGGERS \
         WHERE TRIGGER_SCHEMA = ? AND EVENT_OBJECT_TABLE = ? ORDER BY TRIGGER_NAME",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let name: String = row.get("TRIGGER_NAME");
            let timing: String = row.get("ACTION_TIMING");
            let event: String = row.get("EVENT_MANIPULATION");
            let action: String = row.get("ACTION_STATEMENT");
            // information_schema only exposes the trigger body, not the full
            // CREATE TRIGGER wrapper MySQL actually stored — reconstructed here
            // for consistency with what SQLite/Postgres show in this column.
            let statement = format!(
                "CREATE TRIGGER {} {} {} ON {} FOR EACH ROW {}",
                quote_ident(&name),
                timing,
                event,
                quote_ident(table),
                action
            );
            TriggerInfo { name, timing, event, statement }
        })
        .collect())
}

pub async fn get_table_ddl(pool: &MySqlPool, schema: &str, table: &str) -> Result<String, DbError> {
    let query = format!("SHOW CREATE TABLE {}", quote_qualified(schema, table));
    let row = sqlx::query(sqlx::AssertSqlSafe(query))
        .fetch_one(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
    // Column 0 is the table name, column 1 is the CREATE TABLE statement.
    Ok(row.try_get::<String, _>(1).unwrap_or_default())
}

pub async fn estimated_row_count(pool: &MySqlPool, schema: &str, table: &str) -> Result<Option<i64>, DbError> {
    let row = sqlx::query(
        "SELECT TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?",
    )
    .bind(schema)
    .bind(table)
    .fetch_optional(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;
    Ok(row.and_then(|r| r.try_get::<i64, _>("TABLE_ROWS").ok()))
}
