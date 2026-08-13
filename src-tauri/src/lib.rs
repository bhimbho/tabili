mod app_menu;
mod app_store;
mod commands;
mod connection_registry;
mod credentials;
pub mod db;
pub mod export;
pub mod import;
pub mod sql;
mod ssh_tunnel;

use app_store::AppStore;
use connection_registry::ConnectionRegistry;
use tauri::Manager;
use tauri_specta::{collect_commands, Builder};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt::init();

    let builder = Builder::<tauri::Wry>::new().commands(collect_commands![
        commands::app_info,
        commands::connections::open_connection,
        commands::connections::close_connection,
        commands::connections::list_saved_connections,
        commands::connections::connect_saved,
        commands::connections::delete_saved_connection,
        commands::connections::list_databases,
        commands::connections::switch_database,
        commands::connections::update_connection,
        commands::connections::refresh_menu,
        commands::schema::list_schemas,
        commands::schema::list_tables,
        commands::schema::list_views,
        commands::schema::list_functions,
        commands::schema::get_columns,
        commands::schema::get_indexes,
        commands::schema::get_foreign_keys,
        commands::schema::get_triggers,
        commands::schema::get_table_ddl,
        commands::schema::estimated_row_count,
        commands::rows::fetch_rows,
        commands::rows::insert_row,
        commands::rows::update_row,
        commands::rows::delete_rows,
        commands::ddl::preview_alter_table,
        commands::ddl::preview_add_column,
        commands::ddl::preview_drop_column,
        commands::ddl::execute_ddl,
        commands::console::server_info,
        commands::console::list_statement_log,
        commands::console::clear_statement_log,
        commands::console::list_saved_queries,
        commands::console::save_query,
        commands::console::delete_saved_query,
        commands::transfer::export_tables,
        commands::transfer::preview_csv,
        commands::transfer::import_csv,
        commands::transfer::import_sql_dump,
    ]);

    #[cfg(debug_assertions)]
    builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/bindings.ts",
        )
        .expect("failed to export typescript bindings");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(ConnectionRegistry::default())
        .invoke_handler(builder.invoke_handler())
        .on_menu_event(|app, event| app_menu::on_menu_event(app, event.id().as_ref()))
        .setup(move |app| {
            builder.mount_events(app);

            let data_dir = app.path().app_data_dir().expect("resolve app data dir");
            let app_store = tauri::async_runtime::block_on(async {
                let store = AppStore::open(&data_dir).expect("open app store");
                store.migrate().await.expect("migrate app store");
                store
            });
            app.manage(app_store);

            // Built after the store is managed so "Open Recent" can be populated.
            let handle = app.handle().clone();
            tauri::async_runtime::block_on(async {
                if let Err(e) = app_menu::refresh(&handle).await {
                    // Not fatal — the app still runs, just without our menu — but
                    // silently falling back to the default menu is worth shouting about.
                    tracing::error!("failed to build application menu: {e}");
                }
            });

            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                let window = app.get_webview_window("main").unwrap();
                apply_vibrancy(&window, NSVisualEffectMaterial::Sidebar, None, None)
                    .expect("failed to apply vibrancy");
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
