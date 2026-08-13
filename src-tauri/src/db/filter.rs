use crate::db::types::{ColumnFilter, DbValue};

/// A WHERE clause plus the values to bind, in order. Identifiers are quoted by the
/// caller's `quote` fn and values are always parameterised — filter input never
/// reaches the SQL string.
pub struct WhereClause {
    /// Empty when there is nothing to filter on.
    pub sql: String,
    pub binds: Vec<DbValue>,
}

/// `placeholder` yields the next parameter marker (`?` for SQLite/MySQL, `$1`,
/// `$2`… for Postgres). `cast_text` wraps a column so pattern matching compares
/// as text regardless of the column's real type.
pub fn build_where(
    filters: &[ColumnFilter],
    quote: impl Fn(&str) -> String,
    mut placeholder: impl FnMut() -> String,
    cast_text: impl Fn(&str) -> String,
) -> WhereClause {
    let mut parts = Vec::new();
    let mut binds = Vec::new();

    for filter in filters {
        let col = quote(&filter.column);
        let op = filter.operator;

        if !op.takes_value() {
            parts.push(format!("{col} {}", op.sql_symbol()));
            continue;
        }

        let Some(value) = &filter.value else { continue };

        if op.is_pattern() {
            let raw = match value {
                DbValue::Text(s) | DbValue::Decimal(s) | DbValue::DateTime(s) | DbValue::Uuid(s) => {
                    s.clone()
                }
                DbValue::Int(i) => i.to_string(),
                DbValue::Float(f) => f.to_string(),
                DbValue::Bool(b) => b.to_string(),
                _ => continue,
            };
            parts.push(format!("{} LIKE {}", cast_text(&col), placeholder()));
            binds.push(DbValue::Text(op.wrap_pattern(&raw)));
        } else {
            parts.push(format!("{col} {} {}", op.sql_symbol(), placeholder()));
            binds.push(value.clone());
        }
    }

    if parts.is_empty() {
        return WhereClause { sql: String::new(), binds };
    }
    WhereClause { sql: format!(" WHERE {}", parts.join(" AND ")), binds }
}

pub fn order_clause(order_by: Option<&String>, desc: bool, quote: impl Fn(&str) -> String) -> String {
    match order_by {
        Some(col) => format!(" ORDER BY {} {}", quote(col), if desc { "DESC" } else { "ASC" }),
        None => String::new(),
    }
}
