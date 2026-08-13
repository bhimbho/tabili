use sqlx::{AssertSqlSafe, Row, SqlitePool};

use crate::db::error::DbError;
use crate::db::types::{ColumnInfo, ForeignKeyInfo, IndexInfo, TableInfo, TriggerInfo};

/// Double-embedded quotes to safely inline an identifier where sqlx can't bind
/// one (PRAGMA statements and table names in FROM don't accept bind params).
pub fn quote_ident(ident: &str) -> String {
    format!("\"{}\"", ident.replace('"', "\"\""))
}

pub async fn list_tables(pool: &SqlitePool) -> Result<Vec<TableInfo>, DbError> {
    list_by_type(pool, "table", false).await
}

pub async fn list_views(pool: &SqlitePool) -> Result<Vec<TableInfo>, DbError> {
    list_by_type(pool, "view", true).await
}

async fn list_by_type(pool: &SqlitePool, kind: &str, is_view: bool) -> Result<Vec<TableInfo>, DbError> {
    let rows = sqlx::query(
        "SELECT name FROM sqlite_master WHERE type = ?1 AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .bind(kind)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| TableInfo {
            name: row.get::<String, _>("name"),
            is_view,
            estimated_row_count: None,
        })
        .collect())
}

pub async fn get_columns(pool: &SqlitePool, table: &str) -> Result<Vec<ColumnInfo>, DbError> {
    let query = format!("PRAGMA table_info({})", quote_ident(table));
    let rows = sqlx::query(AssertSqlSafe(query))
        .fetch_all(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| ColumnInfo {
            name: row.get::<String, _>("name"),
            data_type: row.get::<String, _>("type"),
            nullable: row.get::<i64, _>("notnull") == 0,
            is_primary_key: row.get::<i64, _>("pk") > 0,
            default_value: row.try_get::<String, _>("dflt_value").ok(),
            // SQLite has no enumerated types; CHECK-constraint "enums" aren't
            // introspectable as a label list.
            enum_values: Vec::new(),
        })
        .collect())
}

pub async fn get_indexes(pool: &SqlitePool, table: &str) -> Result<Vec<IndexInfo>, DbError> {
    let list_query = format!("PRAGMA index_list({})", quote_ident(table));
    let index_rows = sqlx::query(AssertSqlSafe(list_query))
        .fetch_all(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;

    let mut indexes = Vec::new();
    for idx_row in index_rows {
        let name: String = idx_row.get("name");
        let is_unique = idx_row.get::<i64, _>("unique") != 0;

        let info_query = format!("PRAGMA index_info({})", quote_ident(&name));
        let col_rows = sqlx::query(AssertSqlSafe(info_query))
            .fetch_all(pool)
            .await
            .map_err(|e| DbError::Query(e.to_string()))?;
        let columns = col_rows
            .into_iter()
            .map(|r| r.get::<String, _>("name"))
            .collect();

        indexes.push(IndexInfo { name, columns, is_unique });
    }
    Ok(indexes)
}

pub async fn get_foreign_keys(pool: &SqlitePool, table: &str) -> Result<Vec<ForeignKeyInfo>, DbError> {
    let query = format!("PRAGMA foreign_key_list({})", quote_ident(table));
    let rows = sqlx::query(AssertSqlSafe(query))
        .fetch_all(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| ForeignKeyInfo {
            name: format!("fk_{}_{}", table, row.get::<i64, _>("id")),
            columns: vec![row.get::<String, _>("from")],
            referenced_table: row.get::<String, _>("table"),
            referenced_columns: vec![row.get::<String, _>("to")],
        })
        .collect())
}

pub async fn get_triggers(pool: &SqlitePool, table: &str) -> Result<Vec<TriggerInfo>, DbError> {
    let rows = sqlx::query(
        "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND tbl_name = ?1 ORDER BY name",
    )
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|e| DbError::Query(e.to_string()))?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let sql: String = row.try_get("sql").unwrap_or_default();
            // SQLite only stores the raw CREATE TRIGGER text, so timing/event are
            // recovered from it rather than exposed as catalog columns.
            let upper = sql.to_uppercase();
            let timing = ["BEFORE", "AFTER", "INSTEAD OF"]
                .into_iter()
                .find(|t| upper.contains(t))
                .unwrap_or("")
                .to_string();
            let event = ["INSERT", "UPDATE", "DELETE"]
                .into_iter()
                .find(|e| upper.contains(e))
                .unwrap_or("")
                .to_string();
            TriggerInfo { name: row.get::<String, _>("name"), timing, event, statement: sql }
        })
        .collect())
}

pub async fn get_table_ddl(pool: &SqlitePool, table: &str) -> Result<String, DbError> {
    let row = sqlx::query("SELECT sql FROM sqlite_master WHERE name = ?1")
        .bind(table)
        .fetch_optional(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
    Ok(row
        .and_then(|r| r.try_get::<String, _>("sql").ok())
        .unwrap_or_else(|| format!("-- no stored DDL for {table}")))
}

pub async fn estimated_row_count(pool: &SqlitePool, table: &str) -> Result<Option<i64>, DbError> {
    let query = format!("SELECT COUNT(*) as c FROM {}", quote_ident(table));
    let row = sqlx::query(AssertSqlSafe(query))
        .fetch_one(pool)
        .await
        .map_err(|e| DbError::Query(e.to_string()))?;
    Ok(Some(row.get::<i64, _>("c")))
}
