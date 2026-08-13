use tabili_lib::db::{
    connect_driver, ColumnSpec, ConnectionConfig, DbKind, TableDiff, TableRef,
};

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

fn users() -> TableRef {
    TableRef { database: None, schema: None, table: "users".to_string() }
}

#[tokio::test]
async fn adds_and_drops_columns_via_previewed_ddl() {
    let fixture_path = std::env::var("TABILI_TEST_SQLITE_PATH")
        .expect("set TABILI_TEST_SQLITE_PATH to a fixture .sqlite file");
    let path = format!("{fixture_path}.ddl_test.sqlite");
    std::fs::copy(&fixture_path, &path).expect("copy fixture");

    let driver = connect_driver(DbKind::Sqlite, &config_for(&path))
        .await
        .expect("connect");

    // Structure introspection powers the Structure tab.
    let columns = driver.get_columns(&users()).await.expect("get_columns");
    assert!(columns.iter().any(|c| c.name == "id" && c.is_primary_key));
    let indexes = driver.get_indexes(&users()).await.expect("get_indexes");
    assert!(indexes.iter().all(|i| !i.columns.is_empty()));

    // Add column: build SQL first, then execute it separately (the UI previews
    // the statements between those two steps).
    let add = TableDiff {
        added_columns: vec![ColumnSpec {
            name: "nickname".to_string(),
            data_type: "TEXT".to_string(),
            nullable: true,
            default_value: None,
        }],
        dropped_columns: vec![],
        renamed_columns: vec![],
    };
    let sql = driver.build_alter_table_ddl(&users(), &add).await.expect("build add");
    assert_eq!(sql.len(), 1);
    assert!(sql[0].contains("ADD COLUMN"), "unexpected SQL: {}", sql[0]);
    driver.execute_ddl(&sql).await.expect("execute add");

    let columns = driver.get_columns(&users()).await.expect("get_columns after add");
    assert!(columns.iter().any(|c| c.name == "nickname"));

    // NOT NULL without a default is rejected up front rather than failing mid-migration.
    let bad = TableDiff {
        added_columns: vec![ColumnSpec {
            name: "required_col".to_string(),
            data_type: "TEXT".to_string(),
            nullable: false,
            default_value: None,
        }],
        dropped_columns: vec![],
        renamed_columns: vec![],
    };
    assert!(driver.build_alter_table_ddl(&users(), &bad).await.is_err());

    // Drop column round-trips too.
    let drop = TableDiff {
        added_columns: vec![],
        dropped_columns: vec!["nickname".to_string()],
        renamed_columns: vec![],
    };
    let sql = driver.build_alter_table_ddl(&users(), &drop).await.expect("build drop");
    assert!(sql[0].contains("DROP COLUMN"), "unexpected SQL: {}", sql[0]);
    driver.execute_ddl(&sql).await.expect("execute drop");

    let columns = driver.get_columns(&users()).await.expect("get_columns after drop");
    assert!(!columns.iter().any(|c| c.name == "nickname"));

    driver.close().await.expect("close");
    std::fs::remove_file(&path).ok();
}
