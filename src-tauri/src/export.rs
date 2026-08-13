use serde::{Deserialize, Serialize};
use specta::Type;
use std::collections::HashMap;
use std::io::Write;
use std::path::{Path, PathBuf};

use crate::db::error::DbError;
use crate::db::{DatabaseDriver, DbValue, FetchOptions, SqlDialect, TableRef};

/// Rows are pulled a page at a time and written straight out, so exporting a
/// large table never materialises the whole result set in memory.
const PAGE_SIZE: u32 = 2_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum ExportFormat {
    Csv,
    Json,
    Sql,
}

impl ExportFormat {
    fn extension(self) -> &'static str {
        match self {
            ExportFormat::Csv => "csv",
            ExportFormat::Json => "json",
            ExportFormat::Sql => "sql",
        }
    }
}

/// How to quote CSV fields. Mirrors the "Swap" control in the export dialog.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
pub enum CsvQuoting {
    /// Quote only when the value contains a delimiter, quote or line break.
    IfNeeded,
    Always,
    Never,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CsvOptions {
    /// NULL becomes an empty field rather than the literal text `NULL`.
    pub null_to_empty: bool,
    pub line_break_to_space: bool,
    pub field_names_first_row: bool,
    pub delimiter: String,
    pub quoting: CsvQuoting,
    pub line_break: String,
    /// `.` or `,` — the separator used when writing floats and decimals.
    pub decimal: String,
}

impl Default for CsvOptions {
    fn default() -> Self {
        Self {
            null_to_empty: true,
            line_break_to_space: false,
            field_names_first_row: true,
            delimiter: ",".to_string(),
            quoting: CsvQuoting::IfNeeded,
            line_break: "\n".to_string(),
            decimal: ".".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExportTableSpec {
    pub schema: Option<String>,
    pub table: String,
    /// `None` exports every column, in the table's own order.
    pub columns: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub files: Vec<String>,
    #[specta(type = specta_typescript::Number)]
    pub rows_written: i64,
}

fn first_byte(s: &str, fallback: u8) -> u8 {
    s.as_bytes().first().copied().unwrap_or(fallback)
}

/// Applies the decimal-separator preference to an already-formatted number.
fn with_decimal_sep(text: &str, opts: &CsvOptions) -> String {
    if opts.decimal == "," {
        text.replacen('.', ",", 1)
    } else {
        text.to_string()
    }
}

/// Flattens a value to the text that goes in a CSV field.
fn csv_cell(value: &DbValue, opts: &CsvOptions) -> String {
    let raw = match value {
        DbValue::Null => {
            return if opts.null_to_empty { String::new() } else { "NULL".to_string() }
        }
        // Write-only markers; a fetched row never carries them.
        DbValue::Default => "DEFAULT".to_string(),
        DbValue::Now => "CURRENT_TIMESTAMP".to_string(),
        DbValue::Bool(b) => b.to_string(),
        DbValue::Int(i) => i.to_string(),
        DbValue::Float(f) => with_decimal_sep(&f.to_string(), opts),
        DbValue::Decimal(s) => with_decimal_sep(s, opts),
        DbValue::Text(s) | DbValue::DateTime(s) | DbValue::Uuid(s) | DbValue::Bytes(s) => s.clone(),
        DbValue::Json(v) => v.to_string(),
        DbValue::Array(items) => {
            serde_json::to_string(items).unwrap_or_else(|_| String::from("[]"))
        }
        DbValue::Unsupported { raw, .. } => raw.clone(),
    };

    if opts.line_break_to_space {
        raw.replace("\r\n", " ").replace(['\n', '\r'], " ")
    } else {
        raw
    }
}

/// JSON export keeps native types where it can, so numbers stay numbers rather
/// than becoming strings.
fn json_cell(value: &DbValue) -> serde_json::Value {
    use serde_json::Value;
    match value {
        DbValue::Null => Value::Null,
        DbValue::Default => Value::String("DEFAULT".to_string()),
        DbValue::Now => Value::String("CURRENT_TIMESTAMP".to_string()),
        DbValue::Bool(b) => Value::Bool(*b),
        DbValue::Int(i) => Value::Number((*i).into()),
        DbValue::Float(f) => serde_json::Number::from_f64(*f).map_or(Value::Null, Value::Number),
        // Kept as a string: JSON numbers are f64 and would lose precision.
        DbValue::Decimal(s) => Value::String(s.clone()),
        DbValue::Text(s) | DbValue::DateTime(s) | DbValue::Uuid(s) | DbValue::Bytes(s) => {
            Value::String(s.clone())
        }
        DbValue::Json(v) => v.clone(),
        DbValue::Array(items) => Value::Array(items.iter().map(json_cell).collect()),
        DbValue::Unsupported { raw, .. } => Value::String(raw.clone()),
    }
}

fn quote_ident(name: &str, dialect: SqlDialect) -> String {
    match dialect {
        SqlDialect::MySql => format!("`{}`", name.replace('`', "``")),
        _ => format!("\"{}\"", name.replace('"', "\"\"")),
    }
}

/// Renders a value as a SQL literal. Every string form is single-quoted with
/// embedded quotes doubled, so exported dumps re-import cleanly.
fn sql_literal(value: &DbValue) -> String {
    fn quoted(s: &str) -> String {
        format!("'{}'", s.replace('\'', "''"))
    }
    match value {
        DbValue::Null => "NULL".to_string(),
        DbValue::Default => "DEFAULT".to_string(),
        DbValue::Now => "CURRENT_TIMESTAMP".to_string(),
        DbValue::Bool(b) => if *b { "TRUE" } else { "FALSE" }.to_string(),
        DbValue::Int(i) => i.to_string(),
        DbValue::Float(f) => f.to_string(),
        DbValue::Decimal(s) => s.clone(),
        DbValue::Text(s) | DbValue::DateTime(s) | DbValue::Uuid(s) | DbValue::Bytes(s) => quoted(s),
        DbValue::Json(v) => quoted(&v.to_string()),
        DbValue::Array(items) => {
            quoted(&serde_json::to_string(items).unwrap_or_else(|_| String::from("[]")))
        }
        DbValue::Unsupported { raw, .. } => quoted(raw),
    }
}

/// Resolves the column list for a table, honouring an explicit subset while
/// keeping the server's column order.
fn resolve_columns(page_columns: &[String], requested: Option<&Vec<String>>) -> Vec<String> {
    match requested {
        Some(cols) if !cols.is_empty() => page_columns
            .iter()
            .filter(|c| cols.contains(c))
            .cloned()
            .collect(),
        _ => page_columns.to_vec(),
    }
}

fn qualified(spec: &ExportTableSpec, dialect: SqlDialect) -> String {
    match &spec.schema {
        Some(schema) if !schema.is_empty() => format!(
            "{}.{}",
            quote_ident(schema, dialect),
            quote_ident(&spec.table, dialect)
        ),
        _ => quote_ident(&spec.table, dialect),
    }
}

fn table_ref(spec: &ExportTableSpec) -> TableRef {
    TableRef {
        database: None,
        schema: spec.schema.clone(),
        table: spec.table.clone(),
    }
}

/// Walks every row of `spec` a page at a time, handing each page to `sink`.
/// Returns the total number of rows visited.
async fn for_each_page<F>(
    driver: &dyn DatabaseDriver,
    spec: &ExportTableSpec,
    mut sink: F,
) -> Result<i64, DbError>
where
    F: FnMut(&[String], &[HashMap<String, DbValue>]) -> Result<(), DbError>,
{
    let mut offset = 0u32;
    let mut total = 0i64;
    loop {
        let page = driver
            .fetch_rows(&table_ref(spec), FetchOptions::page(PAGE_SIZE, offset))
            .await?;
        let columns = resolve_columns(&page.columns, spec.columns.as_ref());
        if !page.rows.is_empty() {
            sink(&columns, &page.rows)?;
            total += page.rows.len() as i64;
        }
        if !page.has_more {
            break;
        }
        offset += PAGE_SIZE;
    }
    Ok(total)
}

fn io_err(e: impl std::fmt::Display) -> DbError {
    DbError::Other(format!("export failed: {e}"))
}

async fn write_csv(
    driver: &dyn DatabaseDriver,
    spec: &ExportTableSpec,
    path: &Path,
    opts: &CsvOptions,
) -> Result<i64, DbError> {
    let quote_style = match opts.quoting {
        CsvQuoting::IfNeeded => csv::QuoteStyle::Necessary,
        CsvQuoting::Always => csv::QuoteStyle::Always,
        CsvQuoting::Never => csv::QuoteStyle::Never,
    };
    let terminator = match opts.line_break.as_str() {
        "\r\n" => csv::Terminator::CRLF,
        "\r" => csv::Terminator::Any(b'\r'),
        _ => csv::Terminator::Any(b'\n'),
    };
    let mut writer = csv::WriterBuilder::new()
        .delimiter(first_byte(&opts.delimiter, b','))
        .quote_style(quote_style)
        .terminator(terminator)
        .from_path(path)
        .map_err(io_err)?;

    let mut wrote_header = false;
    let total = for_each_page(driver, spec, |columns, rows| {
        if opts.field_names_first_row && !wrote_header {
            writer.write_record(columns).map_err(io_err)?;
            wrote_header = true;
        }
        for row in rows {
            let record: Vec<String> = columns
                .iter()
                .map(|c| csv_cell(row.get(c).unwrap_or(&DbValue::Null), opts))
                .collect();
            writer.write_record(&record).map_err(io_err)?;
        }
        Ok(())
    })
    .await?;

    // An empty table still gets its header row, matching what other clients emit.
    if opts.field_names_first_row && !wrote_header {
        let page = driver
            .fetch_rows(&table_ref(spec), FetchOptions::page(1, 0))
            .await?;
        let columns = resolve_columns(&page.columns, spec.columns.as_ref());
        if !columns.is_empty() {
            writer.write_record(&columns).map_err(io_err)?;
        }
    }

    writer.flush().map_err(io_err)?;
    Ok(total)
}

async fn write_json(
    driver: &dyn DatabaseDriver,
    spec: &ExportTableSpec,
    path: &Path,
) -> Result<i64, DbError> {
    let file = std::fs::File::create(path).map_err(io_err)?;
    let mut out = std::io::BufWriter::new(file);
    out.write_all(b"[\n").map_err(io_err)?;

    let mut first = true;
    let total = for_each_page(driver, spec, |columns, rows| {
        for row in rows {
            let obj: serde_json::Map<String, serde_json::Value> = columns
                .iter()
                .map(|c| (c.clone(), json_cell(row.get(c).unwrap_or(&DbValue::Null))))
                .collect();
            if !first {
                out.write_all(b",\n").map_err(io_err)?;
            }
            first = false;
            let text = serde_json::to_string(&serde_json::Value::Object(obj)).map_err(io_err)?;
            out.write_all(b"  ").map_err(io_err)?;
            out.write_all(text.as_bytes()).map_err(io_err)?;
        }
        Ok(())
    })
    .await?;

    out.write_all(b"\n]\n").map_err(io_err)?;
    out.flush().map_err(io_err)?;
    Ok(total)
}

/// Appends `spec`'s rows as INSERT statements. Multiple tables share one file,
/// so this takes an already-open writer rather than a path.
async fn write_sql(
    driver: &dyn DatabaseDriver,
    spec: &ExportTableSpec,
    out: &mut impl Write,
    dialect: SqlDialect,
) -> Result<i64, DbError> {
    let target = qualified(spec, dialect);
    writeln!(out, "-- {}", spec.table).map_err(io_err)?;

    let total = for_each_page(driver, spec, |columns, rows| {
        let column_list = columns
            .iter()
            .map(|c| quote_ident(c, dialect))
            .collect::<Vec<_>>()
            .join(", ");
        for row in rows {
            let values = columns
                .iter()
                .map(|c| sql_literal(row.get(c).unwrap_or(&DbValue::Null)))
                .collect::<Vec<_>>()
                .join(", ");
            writeln!(out, "INSERT INTO {target} ({column_list}) VALUES ({values});")
                .map_err(io_err)?;
        }
        Ok(())
    })
    .await?;

    writeln!(out).map_err(io_err)?;
    Ok(total)
}

/// Writes `tables` to disk in `format`.
///
/// `destination` is a full file path when the export produces a single file
/// (one table, or any number of tables as SQL) and a directory otherwise, in
/// which case each table becomes `<table>.<ext>` inside it.
pub async fn export_tables(
    driver: &dyn DatabaseDriver,
    tables: &[ExportTableSpec],
    format: ExportFormat,
    csv_options: &CsvOptions,
    destination: &str,
) -> Result<ExportResult, DbError> {
    if tables.is_empty() {
        return Err(DbError::Other("select at least one table to export".into()));
    }
    let dialect = driver.dialect();
    let destination = PathBuf::from(destination);

    // SQL exports concatenate into one dump regardless of table count.
    if format == ExportFormat::Sql {
        let file = std::fs::File::create(&destination).map_err(io_err)?;
        let mut out = std::io::BufWriter::new(file);
        let mut rows_written = 0i64;
        for spec in tables {
            rows_written += write_sql(driver, spec, &mut out, dialect).await?;
        }
        out.flush().map_err(io_err)?;
        return Ok(ExportResult {
            files: vec![destination.to_string_lossy().to_string()],
            rows_written,
        });
    }

    let single_file = tables.len() == 1;
    if !single_file {
        std::fs::create_dir_all(&destination).map_err(io_err)?;
    }

    let mut files = Vec::new();
    let mut rows_written = 0i64;
    for spec in tables {
        let path = if single_file {
            destination.clone()
        } else {
            destination.join(format!("{}.{}", spec.table, format.extension()))
        };
        rows_written += match format {
            ExportFormat::Csv => write_csv(driver, spec, &path, csv_options).await?,
            ExportFormat::Json => write_json(driver, spec, &path).await?,
            ExportFormat::Sql => unreachable!("handled above"),
        };
        files.push(path.to_string_lossy().to_string());
    }

    Ok(ExportResult { files, rows_written })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn opts() -> CsvOptions {
        CsvOptions::default()
    }

    #[test]
    fn null_renders_empty_or_literal_by_option() {
        let mut o = opts();
        assert_eq!(csv_cell(&DbValue::Null, &o), "");
        o.null_to_empty = false;
        assert_eq!(csv_cell(&DbValue::Null, &o), "NULL");
    }

    #[test]
    fn line_breaks_collapse_to_spaces_when_asked() {
        let mut o = opts();
        let v = DbValue::Text("a\r\nb\nc".into());
        assert_eq!(csv_cell(&v, &o), "a\r\nb\nc");
        o.line_break_to_space = true;
        assert_eq!(csv_cell(&v, &o), "a b c");
    }

    #[test]
    fn decimal_separator_is_applied_once() {
        let mut o = opts();
        o.decimal = ",".to_string();
        assert_eq!(csv_cell(&DbValue::Decimal("1234.56".into()), &o), "1234,56");
    }

    #[test]
    fn sql_literals_escape_embedded_quotes() {
        assert_eq!(sql_literal(&DbValue::Text("it's".into())), "'it''s'");
        assert_eq!(sql_literal(&DbValue::Null), "NULL");
        assert_eq!(sql_literal(&DbValue::Bool(true)), "TRUE");
        assert_eq!(sql_literal(&DbValue::Int(7)), "7");
    }

    #[test]
    fn identifiers_quote_per_dialect() {
        assert_eq!(quote_ident("a b", SqlDialect::Postgres), "\"a b\"");
        assert_eq!(quote_ident("a b", SqlDialect::MySql), "`a b`");
        assert_eq!(quote_ident("we\"ird", SqlDialect::Postgres), "\"we\"\"ird\"");
    }

    #[test]
    fn column_subset_keeps_server_order() {
        let page = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let requested = vec!["c".to_string(), "a".to_string()];
        assert_eq!(resolve_columns(&page, Some(&requested)), vec!["a", "c"]);
        assert_eq!(resolve_columns(&page, None), page);
    }

    #[test]
    fn json_keeps_numbers_native_but_decimals_exact() {
        assert_eq!(json_cell(&DbValue::Int(5)), serde_json::json!(5));
        assert_eq!(
            json_cell(&DbValue::Decimal("0.1000000000000000001".into())),
            serde_json::json!("0.1000000000000000001")
        );
    }
}
