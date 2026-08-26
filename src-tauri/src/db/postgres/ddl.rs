use sqlx::PgPool;

use super::introspect::{quote_ident, quote_qualified};
use crate::db::error::DbError;
use crate::db::types::{ColumnSpec, TableDiff, TableSpec};

/// Postgres DDL is fully transactional, so the whole statement list runs inside a
/// single transaction and rolls back cleanly on failure. (MySQL is the opposite —
/// see mysql/ddl.rs — and SQLite needs a table-recreate dance for most ALTERs.)
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

pub fn build_create_table_ddl(schema: &str, spec: &TableSpec) -> Result<Vec<String>, DbError> {
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
        quote_qualified(schema, &spec.name),
        parts.join(",\n  ")
    )])
}

pub fn build_alter_table_ddl(
    schema: &str,
    table: &str,
    diff: &TableDiff,
) -> Result<Vec<String>, DbError> {
    let qualified = quote_qualified(schema, table);
    let mut statements = Vec::new();

    for col in &diff.added_columns {
        statements.push(format!(
            "ALTER TABLE {} ADD COLUMN {}",
            qualified,
            column_definition(col)
        ));
    }
    for (from, to) in &diff.renamed_columns {
        statements.push(format!(
            "ALTER TABLE {} RENAME COLUMN {} TO {}",
            qualified,
            quote_ident(from),
            quote_ident(to)
        ));
    }
    for col in &diff.dropped_columns {
        statements.push(format!(
            "ALTER TABLE {} DROP COLUMN {}",
            qualified,
            quote_ident(col)
        ));
    }

    if statements.is_empty() {
        return Err(DbError::Other("no schema changes to apply".into()));
    }
    Ok(statements)
}

pub fn build_drop_table_ddl(schema: &str, table: &str) -> Vec<String> {
    vec![format!("DROP TABLE {}", quote_qualified(schema, table))]
}

pub fn build_truncate_table_ddl(schema: &str, table: &str) -> Vec<String> {
    vec![format!("TRUNCATE TABLE {}", quote_qualified(schema, table))]
}

/// Produces ALTER TABLE statements to change a column's type, nullability,
/// and/or default. Renames are handled separately through `TableDiff`.
pub fn build_edit_column_ddl(
    schema: &str,
    table: &str,
    column: &str,
    new_type: Option<&str>,
    nullable: Option<bool>,
    default: Option<Option<&str>>,
) -> Result<Vec<String>, DbError> {
    let qualified = quote_qualified(schema, table);
    let quoted = quote_ident(column);
    let mut statements = Vec::new();

    if let Some(ty) = new_type {
        statements.push(format!(
            "ALTER TABLE {qualified} ALTER COLUMN {quoted} TYPE {ty}"
        ));
    }
    if let Some(nullable) = nullable {
        statements.push(format!(
            "ALTER TABLE {qualified} ALTER COLUMN {quoted} {} NOT NULL",
            if nullable { "DROP" } else { "SET" }
        ));
    }
    if let Some(default) = default {
        match default {
            Some(d) if !d.is_empty() => statements.push(format!(
                "ALTER TABLE {qualified} ALTER COLUMN {quoted} SET DEFAULT {d}"
            )),
            _ => statements.push(format!(
                "ALTER TABLE {qualified} ALTER COLUMN {quoted} DROP DEFAULT"
            )),
        }
    }

    if statements.is_empty() {
        return Err(DbError::Other("no column changes to apply".into()));
    }
    Ok(statements)
}

pub async fn execute_ddl(pool: &PgPool, statements: &[String]) -> Result<(), DbError> {
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
