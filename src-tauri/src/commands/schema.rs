use std::sync::Arc;
use tauri::State;

use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::{
    ColumnInfo, DatabaseDriver, DbError, ForeignKeyInfo, IndexInfo, SchemaInfo, SchemaRef,
    TableInfo, TableRef, TriggerInfo, FunctionInfo,
};

async fn resolve(
    registry: &State<'_, ConnectionRegistry>,
    connection_id: &str,
) -> Result<Arc<dyn DatabaseDriver>, AppError> {
    registry
        .get(connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))
}

/// `schema` is None for SQLite (which has no schemas) and for callers that want
/// the driver's default (`public` on Postgres).
fn table_ref(schema: Option<String>, table: String) -> TableRef {
    TableRef { database: None, schema, table }
}

#[tauri::command]
#[specta::specta]
pub async fn list_schemas(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
) -> Result<Vec<SchemaInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver.list_schemas(None).await.map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn list_tables(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .list_tables(&SchemaRef { database: None, schema })
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn list_views(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<TableInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .list_views(&SchemaRef { database: None, schema })
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn list_functions(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
) -> Result<Vec<FunctionInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .list_functions(&SchemaRef { database: None, schema })
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_columns(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<Vec<ColumnInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .get_columns(&table_ref(schema, table))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_indexes(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<Vec<IndexInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .get_indexes(&table_ref(schema, table))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_foreign_keys(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<Vec<ForeignKeyInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .get_foreign_keys(&table_ref(schema, table))
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_triggers(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<Vec<TriggerInfo>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .get_triggers(&table_ref(schema, table))
        .await
        .map_err(AppError::from)
}

/// Catalog estimate rather than `COUNT(*)`, which is why it can be `None` and
/// why it's cheap enough to fetch whenever the details pane opens.
///
/// Returned as `f64` so the absent case survives into TypeScript as `null` —
/// specta refuses to export a bare `i64`, and annotating it as a number erases
/// the `Option`. An f64 is exact well past any row count a table will reach.
#[tauri::command]
#[specta::specta]
pub async fn estimated_row_count(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<Option<f64>, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .estimated_row_count(&table_ref(schema, table))
        .await
        .map(|count| count.map(|n| n as f64))
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn get_table_ddl(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
) -> Result<String, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    driver
        .get_table_ddl(&table_ref(schema, table))
        .await
        .map_err(AppError::from)
}

/// Everything the ERD viewer needs in one round-trip: every table (and view)
/// in the schema, its columns, and the foreign keys that connect them.
#[derive(serde::Serialize, specta::Type)]
#[serde(rename_all = "camelCase")]
pub struct SchemaGraph {
    pub tables: Vec<TableInfo>,
    pub columns: Vec<(String, Vec<ColumnInfo>)>,
    pub foreign_keys: Vec<(String, Vec<ForeignKeyInfo>)>,
}

#[tauri::command]
#[specta::specta]
pub async fn get_schema_graph(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
) -> Result<SchemaGraph, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    let schema_ref = SchemaRef { database: None, schema: schema.clone() };

    let tables = driver.list_tables(&schema_ref).await?;
    let mut columns = Vec::with_capacity(tables.len());
    let mut foreign_keys = Vec::with_capacity(tables.len());
    for t in &tables {
        let table_ref = TableRef {
            database: None,
            schema: schema.clone(),
            table: t.name.clone(),
        };
        columns.push((t.name.clone(), driver.get_columns(&table_ref).await?));
        foreign_keys.push((t.name.clone(), driver.get_foreign_keys(&table_ref).await?));
    }
    Ok(SchemaGraph { tables, columns, foreign_keys })
}
