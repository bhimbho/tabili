use std::collections::HashMap;
use tabili_lib::db::{connect_driver, ConnectionConfig, DbKind, DbValue, FetchOptions, SchemaRef, TableRef};

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

#[tokio::test]
async fn connects_lists_tables_and_fetches_rows() {
    let path = std::env::var("TABILI_TEST_SQLITE_PATH")
        .expect("set TABILI_TEST_SQLITE_PATH to a fixture .sqlite file");

    let driver = connect_driver(DbKind::Sqlite, &config_for(&path))
        .await
        .expect("connect");

    let tables = driver
        .list_tables(&SchemaRef { database: None, schema: None })
        .await
        .expect("list_tables");
    let table_names: Vec<_> = tables.iter().map(|t| t.name.as_str()).collect();
    assert!(table_names.contains(&"users"));
    assert!(table_names.contains(&"orders"));

    let columns = driver
        .get_columns(&TableRef { database: None, schema: None, table: "users".to_string() })
        .await
        .expect("get_columns");
    let column_names: Vec<_> = columns.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(column_names, vec!["id", "name", "email", "is_active", "created_at"]);
    assert!(columns.iter().find(|c| c.name == "id").unwrap().is_primary_key);
    assert!(!columns.iter().find(|c| c.name == "name").unwrap().nullable);
    assert!(columns.iter().find(|c| c.name == "email").unwrap().nullable);

    let page = driver
        .fetch_rows(
            &TableRef { database: None, schema: None, table: "users".to_string() },
            FetchOptions { limit: 2, offset: 0, order_by: Some("id".to_string()) },
        )
        .await
        .expect("fetch_rows");
    assert_eq!(page.rows.len(), 2);
    assert!(page.has_more, "expected a 3rd row beyond the 2-row page");
    assert_eq!(page.columns, vec!["id", "name", "email", "is_active", "created_at"]);

    let second_page = driver
        .fetch_rows(
            &TableRef { database: None, schema: None, table: "users".to_string() },
            FetchOptions { limit: 2, offset: 2, order_by: Some("id".to_string()) },
        )
        .await
        .expect("fetch_rows page 2");
    assert_eq!(second_page.rows.len(), 1);
    assert!(!second_page.has_more);

    let fks = driver
        .get_foreign_keys(&TableRef { database: None, schema: None, table: "orders".to_string() })
        .await
        .expect("get_foreign_keys");
    assert_eq!(fks.len(), 1);
    assert_eq!(fks[0].referenced_table, "users");

    driver.close().await.expect("close");
}

#[tokio::test]
async fn inserts_updates_and_deletes_rows() {
    let fixture_path = std::env::var("TABILI_TEST_SQLITE_PATH")
        .expect("set TABILI_TEST_SQLITE_PATH to a fixture .sqlite file");
    // Own copy so this test never races/conflicts with the read-only test above.
    let path = format!("{fixture_path}.mutate_test.sqlite");
    std::fs::copy(&fixture_path, &path).expect("copy fixture");

    let driver = connect_driver(DbKind::Sqlite, &config_for(&path))
        .await
        .expect("connect");
    let users = TableRef { database: None, schema: None, table: "users".to_string() };

    let mut values = HashMap::new();
    values.insert("name".to_string(), DbValue::Text("Dana".to_string()));
    values.insert("email".to_string(), DbValue::Text("dana@example.com".to_string()));
    values.insert("is_active".to_string(), DbValue::Int(1));
    driver.insert_row(&users, &values).await.expect("insert_row");

    let page = driver
        .fetch_rows(&users, FetchOptions { limit: 10, offset: 0, order_by: Some("id".to_string()) })
        .await
        .expect("fetch_rows after insert");
    assert_eq!(page.rows.len(), 4, "expected 3 original + 1 inserted row");
    let dana = page
        .rows
        .iter()
        .find(|r| matches!(&r["name"], DbValue::Text(n) if n == "Dana"))
        .expect("inserted row present");
    let DbValue::Int(dana_id) = dana["id"] else { panic!("expected int id") };

    let mut pk = HashMap::new();
    pk.insert("id".to_string(), DbValue::Int(dana_id));
    let mut changes = HashMap::new();
    changes.insert("email".to_string(), DbValue::Null);
    changes.insert("name".to_string(), DbValue::Text("Dana Updated".to_string()));
    driver.update_row(&users, &pk, &changes).await.expect("update_row");

    let page = driver
        .fetch_rows(&users, FetchOptions { limit: 10, offset: 0, order_by: Some("id".to_string()) })
        .await
        .expect("fetch_rows after update");
    let dana = page.rows.iter().find(|r| r["id"] == DbValue::Int(dana_id)).unwrap();
    assert!(matches!(&dana["name"], DbValue::Text(n) if n == "Dana Updated"));
    assert!(matches!(dana["email"], DbValue::Null));

    driver.delete_rows(&users, &[pk]).await.expect("delete_rows");
    let page = driver
        .fetch_rows(&users, FetchOptions { limit: 10, offset: 0, order_by: Some("id".to_string()) })
        .await
        .expect("fetch_rows after delete");
    assert_eq!(page.rows.len(), 3, "back to the original 3 rows after delete");

    driver.close().await.expect("close");
    std::fs::remove_file(&path).ok();
}
