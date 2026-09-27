use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::db::error::AppError;
use crate::db::DbError;

/// Label prefix for per-connection windows. The capability file grants the same
/// prefix, so a window built outside it would come up without permissions.
const CONNECTION_WINDOW_PREFIX: &str = "conn-";

/// Tauri labels accept a restricted alphabet. Ids are uuids today, but ids from
/// older stores are not guaranteed to be, so anything else folds to `_` rather
/// than failing the move.
fn label_for(connection_id: &str) -> String {
    let sanitized: String = connection_id
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    format!("{CONNECTION_WINDOW_PREFIX}{sanitized}")
}

/// Percent-encodes the id for the query string, so an id holding `&` or a space
/// cannot truncate or split the parameter the new window reads back.
fn encode_query_value(value: &str) -> String {
    value
        .bytes()
        .map(|b| match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                (b as char).to_string()
            }
            other => format!("%{other:02X}"),
        })
        .collect()
}

/// Opens (or focuses) a window dedicated to one connection.
///
/// Each webview runs its own copy of the frontend, so the two windows share no
/// store state: a filter, search or pending edit in one cannot reach the other.
/// The connection pool lives in Rust and is shared, so the new window reuses the
/// connection that is already open instead of dialling again.
#[tauri::command]
#[specta::specta]
pub async fn open_connection_window(
    app: AppHandle,
    connection_id: String,
    title: String,
) -> Result<String, AppError> {
    let label = label_for(&connection_id);

    // Moving a connection that already has a window should surface that window
    // rather than stack a second one on top of it.
    if let Some(existing) = app.get_webview_window(&label) {
        let _ = existing.unminimize();
        let _ = existing.set_focus();
        return Ok(label);
    }

    // `connection` tells the fresh webview which connection it owns; the handoff
    // of open tabs rides in shared local storage under the same id.
    let url = format!("index.html?connection={}", encode_query_value(&connection_id));

    let mut builder = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title(if title.trim().is_empty() { "Tabili" } else { title.as_str() })
        .inner_size(1280.0, 800.0)
        .min_inner_size(840.0, 520.0);

    // Matches the main window's chrome from tauri.conf.json; both are macOS-only.
    #[cfg(target_os = "macos")]
    {
        builder = builder
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .transparent(true);
    }

    let window = builder
        .build()
        .map_err(|e| AppError::from(DbError::Other(format!("could not open window: {e}"))))?;

    crate::apply_window_vibrancy(&window);

    Ok(label)
}
