use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// Event name the frontend listens on; the payload is the clicked item's id.
pub const MENU_EVENT: &str = "menu-action";

/// Prefix for dynamically-built "Open Recent" entries. The suffix is the saved
/// connection's id.
pub const RECENT_PREFIX: &str = "recent:";

/// Items whose feature exists today are enabled; the rest are shown greyed so
/// the menu reflects the finished shape of the app rather than hiding what is
/// still to come. Enabled items are *not* disabled per-context — the frontend
/// no-ops safely when there is no active connection or tab, which avoids
/// mirroring the whole UI state into the menu.
struct Item<'a> {
    id: &'a str,
    label: &'a str,
    accel: Option<&'a str>,
    enabled: bool,
}

const fn on<'a>(id: &'a str, label: &'a str, accel: Option<&'a str>) -> Item<'a> {
    Item { id, label, accel, enabled: true }
}

const fn off<'a>(id: &'a str, label: &'a str, accel: Option<&'a str>) -> Item<'a> {
    Item { id, label, accel, enabled: false }
}

fn build_items<R: Runtime>(
    app: &AppHandle<R>,
    items: &[Item<'_>],
) -> tauri::Result<Vec<MenuItem<R>>> {
    items
        .iter()
        .map(|i| MenuItem::with_id(app, i.id, i.label, i.enabled, i.accel))
        .collect()
}

/// Borrowed view over built items so they can be handed to `Submenu::with_items`.
fn refs<'a, R: Runtime>(items: &'a [MenuItem<R>]) -> Vec<&'a dyn tauri::menu::IsMenuItem<R>> {
    items.iter().map(|i| i as &dyn tauri::menu::IsMenuItem<R>).collect()
}

pub fn build_menu<R: Runtime>(
    app: &AppHandle<R>,
    recent: &[(String, String)],
) -> tauri::Result<Menu<R>> {
    let sep = || PredefinedMenuItem::separator(app);

    // --- App menu (macOS convention: app name first) ---
    let app_menu = Submenu::with_items(
        app,
        "Tabili",
        true,
        &[
            &PredefinedMenuItem::about(app, None, None)?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )?;

    // --- File ---
    let export_items = build_items(
        app,
        &[
            on("file.export", "Export…", Some("Shift+CmdOrCtrl+E")),
            on(
                "file.export-table-columns",
                "Export this Table with Column Selection…",
                None,
            ),
        ],
    )?;
    let export_menu = Submenu::with_items(app, "Export", true, &refs(&export_items))?;

    let import_items = build_items(
        app,
        &[
            on("file.import-csv", "From CSV…", None),
            on("file.import-sql", "From SQL Dump…", None),
        ],
    )?;
    let import_menu = Submenu::with_items(app, "Import", true, &refs(&import_items))?;

    let recent_items: Vec<MenuItem<R>> = if recent.is_empty() {
        vec![MenuItem::with_id(
            app,
            "recent.empty",
            "No Recent Connections",
            false,
            None::<&str>,
        )?]
    } else {
        recent
            .iter()
            .map(|(id, name)| {
                MenuItem::with_id(app, format!("{RECENT_PREFIX}{id}"), name, true, None::<&str>)
            })
            .collect::<tauri::Result<_>>()?
    };
    let recent_menu = Submenu::with_items(app, "Open Recent", true, &refs(&recent_items))?;

    let file_top = build_items(
        app,
        &[on("file.open", "Open…", Some("CmdOrCtrl+O"))],
    )?;
    let file_mid = build_items(
        app,
        &[
            off("file.save-as", "Save As…", Some("Shift+CmdOrCtrl+S")),
            off("file.new-workspace", "New Workspace", Some("CmdOrCtrl+N")),
            off("file.new-sql", "New SQL Viewer", Some("Shift+CmdOrCtrl+O")),
        ],
    )?;
    let file_backup = build_items(
        app,
        &[
            off("file.backup", "Backup…", None),
            off("file.restore", "Restore…", None),
        ],
    )?;
    let file_close = build_items(app, &[on("file.close-tab", "Close Tab", Some("CmdOrCtrl+W"))])?;

    let file_menu = Submenu::with_items(
        app,
        "File",
        true,
        &[
            &file_top[0],
            &recent_menu,
            &sep()?,
            &file_mid[0],
            &sep()?,
            &file_mid[1],
            &file_mid[2],
            &sep()?,
            &file_backup[0],
            &file_backup[1],
            &sep()?,
            &export_menu,
            &import_menu,
            &sep()?,
            &PredefinedMenuItem::close_window(app, None)?,
            &file_close[0],
        ],
    )?;

    // --- Edit ---
    let edit_changes = build_items(
        app,
        &[
            on("edit.commit", "Commit", Some("CmdOrCtrl+S")),
            on("edit.discard", "Discard", Some("Shift+CmdOrCtrl+Backspace")),
            on("edit.preview", "Preview", Some("Shift+CmdOrCtrl+P")),
        ],
    )?;
    let edit_rows = build_items(
        app,
        &[
            on("edit.add-row", "Add Row", Some("CmdOrCtrl+I")),
            on("edit.duplicate-row", "Duplicate Row", Some("CmdOrCtrl+D")),
            on("edit.delete-row", "Delete Row", Some("CmdOrCtrl+Backspace")),
        ],
    )?;
    // The grid filters rows from its own always-visible filter bar; a separate
    // Find affordance doesn't exist yet, so it's shown greyed rather than fake.
    let edit_find = build_items(app, &[off("edit.find", "Find…", Some("CmdOrCtrl+F"))])?;
    let edit_comments = build_items(
        app,
        &[
            off("edit.toggle-line-comment", "Toggle Line Comment", Some("CmdOrCtrl+/")),
            off("edit.font-increase", "Increase Font Size", Some("CmdOrCtrl+=")),
            off("edit.font-decrease", "Decrease Font Size", Some("CmdOrCtrl+-")),
        ],
    )?;

    let edit_menu = Submenu::with_items(
        app,
        "Edit",
        true,
        &[
            &PredefinedMenuItem::undo(app, None)?,
            &PredefinedMenuItem::redo(app, None)?,
            &sep()?,
            &edit_changes[0],
            &edit_changes[1],
            &edit_changes[2],
            &sep()?,
            &edit_rows[0],
            &edit_rows[1],
            &edit_rows[2],
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &sep()?,
            &edit_find[0],
            &sep()?,
            &edit_comments[0],
            &edit_comments[1],
            &edit_comments[2],
        ],
    )?;

    // --- View ---
    let view_items = build_items(
        app,
        &[
            on("view.toggle-sidebar", "Toggle Sidebar", Some("CmdOrCtrl+1")),
            on("view.toggle-details", "Toggle Details Pane", Some("CmdOrCtrl+2")),
            on("view.toggle-console", "Toggle Console", Some("CmdOrCtrl+J")),
        ],
    )?;
    let view_menu = Submenu::with_items(
        app,
        "View",
        true,
        &[
            &view_items[0],
            &view_items[1],
            &view_items[2],
            &sep()?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    // --- Connection ---
    let conn_new = build_items(
        app,
        &[
            on("connection.new", "New…", None),
            on("connection.edit", "Edit…", None),
        ],
    )?;
    let conn_open = build_items(
        app,
        &[
            off("connection.open-database", "Open a Database…", Some("CmdOrCtrl+K")),
            on("connection.open", "Open a Connection…", Some("Shift+CmdOrCtrl+K")),
        ],
    )?;
    let conn_run = build_items(
        app,
        &[
            off("connection.run-query", "Run Current Query", Some("CmdOrCtrl+Enter")),
            off("connection.run-all", "Run All Queries", Some("Shift+CmdOrCtrl+Enter")),
        ],
    )?;
    let conn_reload = build_items(
        app,
        &[
            on("connection.reload", "Reload Workspace", Some("CmdOrCtrl+R")),
            on("connection.reload-tab", "Reload Current Tab", Some("Alt+CmdOrCtrl+R")),
            on("connection.reconnect", "Reconnect", Some("Ctrl+CmdOrCtrl+R")),
            on("connection.disconnect", "Disconnect", None),
        ],
    )?;

    let connection_menu = Submenu::with_items(
        app,
        "Connection",
        true,
        &[
            &conn_new[0],
            &conn_new[1],
            &sep()?,
            &conn_open[0],
            &conn_open[1],
            &sep()?,
            &conn_run[0],
            &conn_run[1],
            &sep()?,
            &conn_reload[0],
            &conn_reload[1],
            &conn_reload[2],
            &sep()?,
            &conn_reload[3],
        ],
    )?;

    // --- Tools ---
    let tools_items = build_items(
        app,
        &[
            off("tools.user-management", "User Management…", None),
            off("tools.process-list", "Process List…", None),
            off("tools.search-database", "Search in Database…", Some("Shift+CmdOrCtrl+F")),
        ],
    )?;
    let tools_menu = Submenu::with_items(app, "Tools", true, &refs(&tools_items))?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &connection_menu,
            &tools_menu,
        ],
    )
}

/// Rebuilds the menu so "Open Recent" reflects the current saved connections.
pub async fn refresh<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let store = app.state::<crate::app_store::AppStore>();
    let recent: Vec<(String, String)> = store
        .list()
        .await
        .unwrap_or_default()
        .into_iter()
        .take(10)
        .map(|c| (c.id, c.name))
        .collect();
    let menu = build_menu(app, &recent)?;
    app.set_menu(menu)?;
    tracing::info!("application menu installed ({} recent connections)", recent.len());
    Ok(())
}

/// Forwards every click to the webview. Predefined items (copy/paste/quit…)
/// are handled natively and never reach here.
pub fn on_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    let _ = app.emit(MENU_EVENT, id);
}
