use sqlx::MySqlPool;

use super::introspect::{quote_ident, quote_qualified};
use crate::db::error::DbError;
use crate::db::types::{ColumnSpec, TableDiff, TableSpec};

/// MySQL DDL is NOT transactional — most statements trigger an implicit commit,
/// so unlike Postgres this can't be wrapped in a rollback-on-failure transaction.
/// Each statement is run independently and a failure partway through leaves
/// earlier statements applied; the preview step is the only real safety net.
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

pub fn build_alter_table_ddl(schema: &str, table: &str, diff: &TableDiff) -> Result<Vec<String>, DbError> {
    let qualified = quote_qualified(schema, table);
    let mut statements = Vec::new();

    for col in &diff.added_columns {
        // MySQL only guarantees an implicit default (0, '') outside strict SQL
        // mode; since the server's mode isn't known here, require an explicit
        // DEFAULT for NOT NULL columns rather than risk failing server-side.
        let has_default = col.default_value.as_deref().is_some_and(|d| !d.is_empty());
        if !col.nullable && !has_default {
            return Err(DbError::Unsupported(format!(
                "adding NOT NULL column \"{}\" needs a DEFAULT — existing rows have no value to backfill",
                col.name
            )));
        }
        statements.push(format!("ALTER TABLE {} ADD COLUMN {}", qualified, column_definition(col)));
    }
    for (from, to) in &diff.renamed_columns {
        // RENAME COLUMN is MySQL 8.0+/MariaDB 10.5+ syntax.
        statements.push(format!(
            "ALTER TABLE {} RENAME COLUMN {} TO {}",
            qualified,
            quote_ident(from),
            quote_ident(to)
        ));
    }
    for col in &diff.dropped_columns {
        statements.push(format!("ALTER TABLE {} DROP COLUMN {}", qualified, quote_ident(col)));
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
/// and/or default. MySQL's MODIFY COLUMN takes the full definition, so type
/// changes and NOT NULL are combined; renames go through `TableDiff`.
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

    let has_type = new_type.is_some();
    let has_null = nullable.is_some();
    let has_default = default.is_some();
    if !has_type && !has_null && !has_default {
        return Err(DbError::Other("no column changes to apply".into()));
    }

    // MySQL MODIFY COLUMN needs the full type + constraints. If only
    // nullability/default changed, we still need a type; the caller should
    // supply the current type. Fall back to an error if absent.
    let ty = new_type.ok_or_else(|| {
        DbError::Other("MySQL edit-column requires the column type".into())
    })?;
    let mut sql = format!("ALTER TABLE {qualified} MODIFY COLUMN {quoted} {ty}");
    if let Some(nullable) = nullable {
        sql.push_str(if nullable { "" } else { " NOT NULL" });
    }
    if let Some(default) = default {
        match default {
            Some(d) if !d.is_empty() => sql.push_str(&format!(" DEFAULT {d}")),
            _ => sql.push_str(" DEFAULT NULL"),
        }
    }

    Ok(vec![sql])
}

pub async fn execute_ddl(pool: &MySqlPool, statements: &[String]) -> Result<(), DbError> {
    for statement in statements {
        sqlx::query(sqlx::AssertSqlSafe(statement.clone()))
            .execute(pool)
            .await
            .map_err(|e| DbError::Query(format!("{statement}: {e}")))?;
    }
    Ok(())
}
