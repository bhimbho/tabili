use tauri::State;

use crate::connection_registry::ConnectionRegistry;
use crate::db::error::AppError;
use crate::db::DbError;
use crate::export::{self, CsvOptions, ExportFormat, ExportResult, ExportTableSpec};
use crate::import::{self, CsvImportOptions, CsvPreview, ImportResult};

async fn resolve(
    registry: &State<'_, ConnectionRegistry>,
    connection_id: &str,
) -> Result<std::sync::Arc<dyn crate::db::DatabaseDriver>, AppError> {
    registry
        .get(connection_id)
        .await
        .ok_or_else(|| AppError::from(DbError::Connection("unknown connection".into())))
}

#[tauri::command]
#[specta::specta]
pub async fn export_tables(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    tables: Vec<ExportTableSpec>,
    format: ExportFormat,
    csv_options: CsvOptions,
    destination: String,
    gzip: bool,
) -> Result<ExportResult, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    export::export_tables(
        driver.as_ref(),
        &tables,
        format,
        &csv_options,
        &destination,
        gzip,
    )
    .await
    .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn preview_csv(path: String, options: CsvImportOptions) -> Result<CsvPreview, AppError> {
    import::preview_csv(&path, &options).map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn import_csv(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    schema: Option<String>,
    table: String,
    path: String,
    options: CsvImportOptions,
) -> Result<ImportResult, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    import::import_csv(driver.as_ref(), schema, table, &path, &options)
        .await
        .map_err(AppError::from)
}

#[tauri::command]
#[specta::specta]
pub async fn import_sql_dump(
    registry: State<'_, ConnectionRegistry>,
    connection_id: String,
    path: String,
) -> Result<ImportResult, AppError> {
    let driver = resolve(&registry, &connection_id).await?;
    import::import_sql_dump(driver.as_ref(), &path)
        .await
        .map_err(AppError::from)
}
