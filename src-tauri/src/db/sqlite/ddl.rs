use sqlx::SqlitePool;

use super::introspect::quote_ident;
use crate::db::error::DbError;
use crate::db::types::{ColumnSpec, TableDiff, TableSpec};

/// SQLite's ALTER TABLE is far more restricted than Postgres/MySQL: it supports
/// only RENAME TABLE, RENAME COLUMN, ADD COLUMN, and (3.35+) DROP COLUMN. Anything
/// else — changing a column type, adding a constraint — requires the documented
/// 12-step "create new table, copy, drop, rename" recreate dance, which is why
/// this returns a Vec and callers always run it in a transaction.
///
/// A column added to an existing table cannot be NOT NULL without a DEFAULT
/// (SQLite has no value to backfill existing rows with), so that's rejected up
/// front rather than failing mid-migration.
fn column_definition(col: &ColumnSpec) -> String {
    let mut sql = format!("{} {}", quote_ident(&col.name), col.data_type);
    if !col.nullable {
        sql.push_str(" NOT NULL");
    }
    if let Some(default) = &col.default_value {
        if !default.is_empty() {
            sql.push_str(&format!(" DEFAULT {default}"));
        }
    }
    sql
}

pub fn build_create_table_ddl(spec: &TableSpec) -> Result<Vec<String>, DbError> {
    if spec.columns.is_empty() {
        return Err(DbError::Other("a table needs at least one column".into()));
    }
    let mut parts: Vec<String> = spec.columns.iter().map(column_definition).collect();
    if !spec.primary_key.is_empty() {
        let pk_cols: Vec<String> = spec.primary_key.iter().map(|c| quote_ident(c)).collect();
        parts.push(format!("PRIMARY KEY ({})", pk_cols.join(", ")));
    }
    Ok(vec![format!(
        "CREATE TABLE {} (\n  {}\n)",
        quote_ident(&spec.name),
        parts.join(",\n  ")
    )])
}

pub fn build_alter_table_ddl(table: &str, diff: &TableDiff) -> Result<Vec<String>, DbError> {
    let quoted = quote_ident(table);
    let mut statements = Vec::new();

    for col in &diff.added_columns {
        let has_default = col.default_value.as_deref().is_some_and(|d| !d.is_empty());
        if !col.nullable && !has_default {
            return Err(DbError::Unsupported(format!(
                "SQLite cannot add NOT NULL column \"{}\" without a DEFAULT — existing rows have no value to backfill",
                col.name
            )));
        }
        statements.push(format!("ALTER TABLE {} ADD COLUMN {}", quoted, column_definition(col)));
    }
    for (from, to) in &diff.renamed_columns {
        statements.push(format!(
            "ALTER TABLE {} RENAME COLUMN {} TO {}",
            quoted,
            quote_ident(from),
            quote_ident(to)
        ));
    }
    for col in &diff.dropped_columns {
        statements.push(format!("ALTER TABLE {} DROP COLUMN {}", quoted, quote_ident(col)));
    }

    if statements.is_empty() {
        return Err(DbError::Other("no schema changes to apply".into()));
    }
    Ok(statements)
}

pub fn build_drop_table_ddl(table: &str) -> Vec<String> {
    vec![format!("DROP TABLE {}", quote_ident(table))]
}

pub fn build_truncate_table_ddl(table: &str) -> Vec<String> {
    // SQLite has no TRUNCATE; DELETE FROM (without WHERE) is equivalent.
    vec![format!("DELETE FROM {}", quote_ident(table))]
}

pub fn build_create_index_ddl(
    table: &str,
    index_name: &str,
    unique: bool,
    columns: &[String],
) -> String {
    let cols: Vec<String> = columns.iter().map(|c| quote_ident(c)).collect();
    format!(
        "CREATE {}INDEX {} ON {} ({})",
        if unique { "UNIQUE " } else { "" },
        quote_ident(index_name),
        quote_ident(table),
        cols.join(", ")
    )
}

pub async fn execute_ddl(pool: &SqlitePool, statements: &[String]) -> Result<(), DbError> {
    let mut tx = pool.begin().await.map_err(|e| DbError::Query(e.to_string()))?;
    for statement in statements {
        sqlx::query(sqlx::AssertSqlSafe(statement.clone()))
            .execute(&mut *tx)
            .await
            .map_err(|e| DbError::Query(format!("{statement}: {e}")))?;
    }
    tx.commit().await.map_err(|e| DbError::Query(e.to_string()))?;
    Ok(())
}
