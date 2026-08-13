use tabili_lib::db::{connect_driver, ConnectionConfig, DbKind};
use tabili_lib::export::{export_tables, CsvOptions, ExportFormat, ExportTableSpec};
use tabili_lib::import::{import_csv, CsvImportOptions};

fn config_for(path: &str) -> ConnectionConfig {
    ConnectionConfig {
        host: String::new(),
        port: 0,
        username: String::new(),
        password: None,
        database: None,
        ssl_mode: None,
        ssl_key_path: None,
        ssl_cert_path: None,
        ssl_ca_path: None,
        file_path: Some(path.to_string()),
        max_connections: 1,
    }
}

fn fixture() -> String {
    std::env::var("TABILI_TEST_SQLITE_PATH")
        .expect("set TABILI_TEST_SQLITE_PATH to a fixture .sqlite file")
}

fn out_dir() -> std::path::PathBuf {
    let dir = std::env::temp_dir().join("tabili-export-tests");
    std::fs::create_dir_all(&dir).expect("create temp dir");
    dir
}

fn spec(table: &str, columns: Option<Vec<String>>) -> ExportTableSpec {
    ExportTableSpec { schema: None, table: table.to_string(), columns }
}

#[tokio::test]
async fn exports_csv_with_header_and_all_rows() {
    let driver = connect_driver(DbKind::Sqlite, &config_for(&fixture()))
        .await
        .expect("connect");
    let path = out_dir().join("users.csv");

    let result = export_tables(
        driver.as_ref(),
        &[spec("users", None)],
        ExportFormat::Csv,
        &CsvOptions::default(),
        path.to_str().unwrap(),
    )
    .await
    .expect("export csv");

    assert_eq!(result.files.len(), 1);
    let text = std::fs::read_to_string(&path).expect("read csv");
    let lines: Vec<&str> = text.lines().collect();
    assert_eq!(lines[0], "id,name,email,is_active,created_at");
    // Header plus one line per exported row.
    assert_eq!(lines.len() as i64, result.rows_written + 1);
    assert!(result.rows_written > 0, "fixture should have rows");
}

#[tokio::test]
async fn csv_column_subset_limits_columns() {
    let driver = connect_driver(DbKind::Sqlite, &config_for(&fixture()))
        .await
        .expect("connect");
    let path = out_dir().join("users-subset.csv");

    export_tables(
        driver.as_ref(),
        &[spec("users", Some(vec!["name".into(), "id".into()]))],
        ExportFormat::Csv,
        &CsvOptions::default(),
        path.to_str().unwrap(),
    )
    .await
    .expect("export csv subset");

    let text = std::fs::read_to_string(&path).expect("read csv");
    // Requested out of order, but written in the table's own column order.
    assert_eq!(text.lines().next().unwrap(), "id,name");
}

#[tokio::test]
async fn exports_json_as_a_parseable_array() {
    let driver = connect_driver(DbKind::Sqlite, &config_for(&fixture()))
        .await
        .expect("connect");
    let path = out_dir().join("users.json");

    let result = export_tables(
        driver.as_ref(),
        &[spec("users", None)],
        ExportFormat::Json,
        &CsvOptions::default(),
        path.to_str().unwrap(),
    )
    .await
    .expect("export json");

    let text = std::fs::read_to_string(&path).expect("read json");
    let parsed: serde_json::Value = serde_json::from_str(&text).expect("valid json");
    let array = parsed.as_array().expect("top level array");
    assert_eq!(array.len() as i64, result.rows_written);
    assert!(array[0].get("id").is_some(), "rows are keyed objects");
}

#[tokio::test]
async fn exports_sql_inserts_that_round_trip() {
    let driver = connect_driver(DbKind::Sqlite, &config_for(&fixture()))
        .await
        .expect("connect");
    let path = out_dir().join("users.sql");

    let result = export_tables(
        driver.as_ref(),
        &[spec("users", None)],
        ExportFormat::Sql,
        &CsvOptions::default(),
        path.to_str().unwrap(),
    )
    .await
    .expect("export sql");

    let text = std::fs::read_to_string(&path).expect("read sql");
    let inserts = text.lines().filter(|l| l.starts_with("INSERT INTO")).count();
    assert_eq!(inserts as i64, result.rows_written);
    assert!(text.contains("INSERT INTO \"users\" ("), "quoted identifier: {text:.120}");

    // Every statement must be individually splittable, which is what import relies on.
    let statements = tabili_lib::sql::splitter::split_statements(&text);
    assert_eq!(statements.len() as i64, result.rows_written);
}

#[tokio::test]
async fn multiple_tables_write_one_file_each() {
    let driver = connect_driver(DbKind::Sqlite, &config_for(&fixture()))
        .await
        .expect("connect");
    let dir = out_dir().join("multi");
    let _ = std::fs::remove_dir_all(&dir);

    let result = export_tables(
        driver.as_ref(),
        &[spec("users", None), spec("orders", None)],
        ExportFormat::Csv,
        &CsvOptions::default(),
        dir.to_str().unwrap(),
    )
    .await
    .expect("export multi");

    assert_eq!(result.files.len(), 2);
    assert!(dir.join("users.csv").exists());
    assert!(dir.join("orders.csv").exists());
}

/// Exports a table to CSV then imports it back into a scratch copy of the same
/// schema, which exercises the writer and reader against each other.
#[tokio::test]
async fn csv_round_trips_through_import() {
    let source = fixture();
    let scratch = out_dir().join("roundtrip.sqlite");
    let _ = std::fs::remove_file(&scratch);
    std::fs::copy(&source, &scratch).expect("copy fixture");

    let driver = connect_driver(DbKind::Sqlite, &config_for(scratch.to_str().unwrap()))
        .await
        .expect("connect scratch");

    let csv_path = out_dir().join("roundtrip.csv");
    let exported = export_tables(
        driver.as_ref(),
        &[spec("users", None)],
        ExportFormat::Csv,
        &CsvOptions::default(),
        csv_path.to_str().unwrap(),
    )
    .await
    .expect("export");

    // Re-importing the same rows doubles the table (ids collide only if the
    // fixture has a unique constraint, so use a table copy without one).
    driver
        .execute_ddl(&["CREATE TABLE users_copy AS SELECT * FROM users WHERE 0".to_string()])
        .await
        .expect("create scratch table");

    let imported = import_csv(
        driver.as_ref(),
        None,
        "users_copy".to_string(),
        csv_path.to_str().unwrap(),
        &CsvImportOptions::default(),
    )
    .await
    .expect("import");

    assert_eq!(imported.rows_imported, exported.rows_written);
    assert!(imported.skipped_columns.is_empty(), "columns should all match");
}
