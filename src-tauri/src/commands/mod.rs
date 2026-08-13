pub mod connections;
pub mod console;
pub mod ddl;
pub mod rows;
pub mod schema;
pub mod transfer;

use serde::Serialize;
use specta::Type;

#[derive(Debug, Clone, Serialize, Type)]
pub struct AppInfo {
    pub name: String,
    pub version: String,
}

/// Trivial round-trip command used to validate the Rust <-> React IPC + typed
/// bindings pipeline (tauri-specta) end to end. Superseded by real commands
/// (connections.rs, schema.rs, query.rs, rows.rs, ddl.rs) starting M1.
#[tauri::command]
#[specta::specta]
pub fn app_info() -> AppInfo {
    AppInfo {
        name: "tabili".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
    }
}
