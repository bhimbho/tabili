use crate::db::types::{ColumnFilter, DbValue};

/// A WHERE clause plus the values to bind, in order. Identifiers are quoted by the
/// caller's `quote` fn and values are always parameterised — filter input never
/// reaches the SQL string.
pub struct WhereClause {
    /// Empty when there is nothing to filter on.
    pub sql: String,
    pub binds: Vec<DbValue>,
}

/// Per-dialect knobs for clause building.
pub struct Dialect<Q, P, C> {
    /// Quote an identifier.
    pub quote: Q,
    /// Yield the next parameter marker (`?` for SQLite/MySQL, `$1`, `$2`… for Postgres).
    pub placeholder: P,
    /// Wrap a column so pattern matching compares as text whatever its real type.
    pub cast_text: C,
    /// Case-insensitive LIKE keyword. Postgres needs `ILIKE`; SQLite's `LIKE` is
    /// already case-insensitive for ASCII, and plain `LIKE` is the portable
    /// spelling there.
    pub like: &'static str,
}

pub fn build_where<Q, P, C>(filters: &[ColumnFilter], mut d: Dialect<Q, P, C>) -> WhereClause
where
    Q: Fn(&str) -> String,
    P: FnMut() -> String,
    C: Fn(&str) -> String,
{
    let mut parts = Vec::new();
    let mut binds = Vec::new();

    for filter in filters {
        let col = (d.quote)(&filter.column);
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
            parts.push(format!(
                "{} {} {}",
                (d.cast_text)(&col),
                d.like,
                (d.placeholder)()
            ));
            binds.push(DbValue::Text(op.wrap_pattern(&raw)));
        } else {
            parts.push(format!("{col} {} {}", op.sql_symbol(), (d.placeholder)()));
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::types::FilterOperator;

    fn pg(filters: &[ColumnFilter]) -> WhereClause {
        let mut i = 0;
        build_where(
            filters,
            Dialect {
                quote: |c: &str| format!("\"{c}\""),
                placeholder: || {
                    i += 1;
                    format!("${i}")
                },
                cast_text: |c: &str| format!("{c}::text"),
                like: "ILIKE",
            },
        )
    }

    fn filter(column: &str, operator: FilterOperator, value: Option<DbValue>) -> ColumnFilter {
        ColumnFilter { column: column.to_string(), operator, value }
    }

    #[test]
    fn pattern_match_is_case_insensitive_on_postgres() {
        let w = pg(&[filter(
            "name",
            FilterOperator::Contains,
            Some(DbValue::Text("bit".into())),
        )]);
        assert_eq!(w.sql, " WHERE \"name\"::text ILIKE $1");
        assert_eq!(w.binds, vec![DbValue::Text("%bit%".into())]);
    }

    #[test]
    fn placeholders_increment_across_filters() {
        let w = pg(&[
            filter("a", FilterOperator::Equals, Some(DbValue::Int(1))),
            filter("b", FilterOperator::Contains, Some(DbValue::Text("x".into()))),
        ]);
        assert_eq!(w.sql, " WHERE \"a\" = $1 AND \"b\"::text ILIKE $2");
        assert_eq!(w.binds.len(), 2);
    }

    #[test]
    fn null_checks_take_no_operand() {
        let w = pg(&[filter("email", FilterOperator::IsNull, None)]);
        assert_eq!(w.sql, " WHERE \"email\" IS NULL");
        assert!(w.binds.is_empty());
    }

    #[test]
    fn no_filters_yields_no_clause() {
        assert_eq!(pg(&[]).sql, "");
    }

    #[test]
    fn value_is_never_interpolated_into_sql() {
        let w = pg(&[filter(
            "name",
            FilterOperator::Equals,
            Some(DbValue::Text("' OR 1=1 --".into())),
        )]);
        assert!(!w.sql.contains("OR 1=1"), "value leaked into SQL: {}", w.sql);
    }
}
