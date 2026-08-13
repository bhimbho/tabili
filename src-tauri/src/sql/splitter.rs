/// Splits a SQL script into individual statements on `;`, ignoring semicolons
/// that appear inside string literals, quoted identifiers, comments, or
/// Postgres dollar-quoted bodies. Naive `split(';')` corrupts any dump
/// containing a semicolon in a text value or a function body, which is why this
/// exists rather than a one-liner.
pub fn split_statements(script: &str) -> Vec<String> {
    let chars: Vec<char> = script.chars().collect();
    let mut statements = Vec::new();
    let mut current = String::new();
    let mut i = 0;

    while i < chars.len() {
        let c = chars[i];

        match c {
            // Line comment: skip to end of line, keeping the newline as whitespace.
            '-' if chars.get(i + 1) == Some(&'-') => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            // MySQL's `#` line comment. Only treated as a comment at a token
            // boundary so it can't swallow an identifier containing '#'.
            '#' if current.chars().last().is_none_or(|p| p.is_whitespace()) => {
                while i < chars.len() && chars[i] != '\n' {
                    i += 1;
                }
            }
            // Block comment.
            '/' if chars.get(i + 1) == Some(&'*') => {
                i += 2;
                while i < chars.len() && !(chars[i] == '*' && chars.get(i + 1) == Some(&'/')) {
                    i += 1;
                }
                i = (i + 2).min(chars.len());
            }
            // Quoted string or identifier.
            '\'' | '"' | '`' => {
                let quote = c;
                current.push(c);
                i += 1;
                while i < chars.len() {
                    let q = chars[i];
                    // Backslash escape (MySQL string literals).
                    if q == '\\' && quote == '\'' && i + 1 < chars.len() {
                        current.push(q);
                        current.push(chars[i + 1]);
                        i += 2;
                        continue;
                    }
                    // A doubled quote is an escaped quote, not a terminator.
                    if q == quote {
                        if chars.get(i + 1) == Some(&quote) {
                            current.push(q);
                            current.push(q);
                            i += 2;
                            continue;
                        }
                        current.push(q);
                        i += 1;
                        break;
                    }
                    current.push(q);
                    i += 1;
                }
            }
            // Postgres dollar quoting: $$ ... $$ or $tag$ ... $tag$.
            '$' => {
                if let Some(tag) = dollar_tag(&chars, i) {
                    let close = format!("${tag}$");
                    current.push_str(&close);
                    i += close.len();
                    let close_chars: Vec<char> = close.chars().collect();
                    while i < chars.len() && !starts_with_at(&chars, i, &close_chars) {
                        current.push(chars[i]);
                        i += 1;
                    }
                    if i < chars.len() {
                        current.push_str(&close);
                        i += close_chars.len();
                    }
                } else {
                    current.push(c);
                    i += 1;
                }
            }
            ';' => {
                let statement = current.trim().to_string();
                if !statement.is_empty() {
                    statements.push(statement);
                }
                current.clear();
                i += 1;
            }
            _ => {
                current.push(c);
                i += 1;
            }
        }
    }

    let last = current.trim().to_string();
    if !last.is_empty() {
        statements.push(last);
    }
    statements
}

/// If a `$` at `start` opens a dollar-quote, returns the tag between the
/// dollars (empty for `$$`). Returns None for `$1`-style placeholders.
fn dollar_tag(chars: &[char], start: usize) -> Option<String> {
    let mut j = start + 1;
    let mut tag = String::new();
    while j < chars.len() && chars[j] != '$' {
        // Tags are identifier-like; anything else means this isn't a dollar quote.
        if !chars[j].is_alphanumeric() && chars[j] != '_' {
            return None;
        }
        tag.push(chars[j]);
        j += 1;
    }
    // A leading digit means it's a positional placeholder ($1), not a tag.
    if tag.chars().next().is_some_and(|c| c.is_ascii_digit()) {
        return None;
    }
    if j < chars.len() && chars[j] == '$' {
        Some(tag)
    } else {
        None
    }
}

fn starts_with_at(chars: &[char], at: usize, needle: &[char]) -> bool {
    if at + needle.len() > chars.len() {
        return false;
    }
    chars[at..at + needle.len()] == *needle
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn splits_plain_statements() {
        let s = split_statements("SELECT 1; SELECT 2;");
        assert_eq!(s, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn trailing_statement_without_semicolon_is_kept() {
        let s = split_statements("SELECT 1;\nSELECT 2");
        assert_eq!(s, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn semicolon_inside_string_does_not_split() {
        let s = split_statements("INSERT INTO t VALUES ('a;b'); SELECT 1");
        assert_eq!(s, vec!["INSERT INTO t VALUES ('a;b')", "SELECT 1"]);
    }

    #[test]
    fn doubled_quote_is_an_escape_not_a_terminator() {
        let s = split_statements("INSERT INTO t VALUES ('it''s; fine'); SELECT 1");
        assert_eq!(s, vec!["INSERT INTO t VALUES ('it''s; fine')", "SELECT 1"]);
    }

    #[test]
    fn backslash_escaped_quote_is_handled() {
        let s = split_statements(r"INSERT INTO t VALUES ('a\'; b'); SELECT 1");
        assert_eq!(s.len(), 2, "got {s:?}");
    }

    #[test]
    fn semicolon_inside_quoted_identifier_does_not_split() {
        let s = split_statements("SELECT \"we;ird\" FROM t; SELECT 1");
        assert_eq!(s, vec!["SELECT \"we;ird\" FROM t", "SELECT 1"]);
    }

    #[test]
    fn line_comments_are_stripped() {
        let s = split_statements("SELECT 1; -- a; comment\nSELECT 2;");
        assert_eq!(s, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn block_comments_are_stripped() {
        let s = split_statements("SELECT 1; /* a; b */ SELECT 2;");
        assert_eq!(s, vec!["SELECT 1", "SELECT 2"]);
    }

    #[test]
    fn dollar_quoted_body_is_one_statement() {
        let script = "CREATE FUNCTION f() RETURNS int AS $$ BEGIN; RETURN 1; END; $$ LANGUAGE plpgsql; SELECT 1;";
        let s = split_statements(script);
        assert_eq!(s.len(), 2, "got {s:?}");
        assert!(s[0].contains("RETURN 1"));
    }

    #[test]
    fn tagged_dollar_quote_is_one_statement() {
        let script = "SELECT $tag$ a; b $tag$; SELECT 1;";
        let s = split_statements(script);
        assert_eq!(s.len(), 2, "got {s:?}");
    }

    #[test]
    fn positional_placeholders_are_not_dollar_quotes() {
        let s = split_statements("SELECT * FROM t WHERE a = $1; SELECT 2;");
        assert_eq!(s, vec!["SELECT * FROM t WHERE a = $1", "SELECT 2"]);
    }

    #[test]
    fn empty_and_whitespace_statements_are_dropped() {
        let s = split_statements(";;\n  ;\nSELECT 1;;");
        assert_eq!(s, vec!["SELECT 1"]);
    }
}
