use std::collections::HashMap;
use std::time::Instant;
use tauri::State;

use crate::app_store::{AppStore, StatementLogEntry};
use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{ColumnFilter, DbError, DbValue, FetchOptions, RowPage, TableRef};

async fn resolve(
    registry: &State<'_, ConnectionRegistry>,
    connection_id: &str,
) -> Result<std::sync::Arc<dyn crate::db::DatabaseDriver>, AppError> {
    registry
        .get(connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))
}

fn table_ref(schema: Option<String>, table: String) -> TableRef {
    TableRef { database: None, schema, table }
}

/// Records what ran (and whether it worked) so the console and History tab show
/// real statements rather than a reconstruction.
async fn log(
    store: &State<'_, AppStore>,
    connection_id: &str,
    statements: &[String],
    started: Instant,
    error: Option<&str>,
) {
    let duration_ms = started.elapsed().as_millis() as i64;
    for sql in statements {
        let entry = StatementLogEntry {
            id: uuid::Uuid::new_v4().to_string(),
            connection_id: connection_id.to_string(),
            sql: sql.clone(),
            success: error.is_none(),
            error: error.map(|e| e.to_string()),
            duration_ms,
            executed_at: String::new(),
        };
        let _ = store.log_statement(&entry).await;
    }
}

#[tauri::command]
#[specta::specta]
#[allow(clippy::too_many_arguments)]
pub async fn fetch_rows(
    registry: State<'_, ConnectionRegistry>,
    app_store: State<'_, AppStore>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    limit: u32,
    offset: u32,
    order_by: Option<String>,
    order_desc: bool,
    filters: Vec<ColumnFilter>,
) -> Result<RowPage, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    let started = Instant::now();
    let result = driver
        .fetch_rows(
            &table_ref(schema, table),
            FetchOptions { limit, offset, order_by, order_desc, filters },
        )
        .await;

    match result {
        Ok(page) => {
            log(&app_store, &connection_id, &[page.sql.clone()], started, None).await;
            Ok(page)
        }
        Err(e) => {
            let msg = e.to_string();
            log(&app_store, &connection_id, &["SELECT".into()], started, Some(&msg)).await;
            Err(AppError::from(e))
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn insert_row(
    registry: State<'_, ConnectionRegistry>,
    app_store: State<'_, AppStore>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    values: HashMap<String, DbValue>,
) -> Result<String, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    let started = Instant::now();
    match driver.insert_row(&table_ref(schema, table), &values).await {
        Ok(sql) => {
            log(&app_store, &connection_id, &[sql.clone()], started, None).await;
            Ok(sql)
        }
        Err(e) => {
            let msg = e.to_string();
            log(&app_store, &connection_id, &["INSERT".into()], started, Some(&msg)).await;
            Err(AppError::from(e))
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn update_row(
    registry: State<'_, ConnectionRegistry>,
    app_store: State<'_, AppStore>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    pk: HashMap<String, DbValue>,
    changes: HashMap<String, DbValue>,
) -> Result<String, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    let started = Instant::now();
    match driver.update_row(&table_ref(schema, table), &pk, &changes).await {
        Ok(sql) => {
            log(&app_store, &connection_id, &[sql.clone()], started, None).await;
            Ok(sql)
        }
        Err(e) => {
            let msg = e.to_string();
            log(&app_store, &connection_id, &["UPDATE".into()], started, Some(&msg)).await;
            Err(AppError::from(e))
        }
    }
}

#[tauri::command]
#[specta::specta]
pub async fn delete_rows(
    registry: State<'_, ConnectionRegistry>,
    app_store: State<'_, AppStore>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    pks: Vec<HashMap<String, DbValue>>,
) -> Result<Vec<String>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    let started = Instant::now();
    match driver.delete_rows(&table_ref(schema, table), &pks).await {
        Ok(sqls) => {
            log(&app_store, &connection_id, &sqls, started, None).await;
            Ok(sqls)
        }
        Err(e) => {
            let msg = e.to_string();
            log(&app_store, &connection_id, &["DELETE".into()], started, Some(&msg)).await;
            Err(AppError::from(e))
        }
    }
}
