# tabili

A native macOS database client. *Tabili* is Yoruba for "table".

Built with Tauri v2 (Rust) + React + TypeScript.

## Status

Early development. Working today:

- **Connections** — PostgreSQL, MySQL/MariaDB and SQLite, with SSL modes and client cert/key/CA support. Connection metadata is stored locally; passwords go to the macOS Keychain and never touch disk. Saved connections persist across restarts.
- **Browsing** — schema/table explorer, paginated virtualized data grid.
- **Editing** — inline cell editing, row insert and delete, staged as pending changes and reviewed as SQL before you commit. Tables without a primary key are read-only.
- **Structure** — per-table columns, indexes and foreign keys, plus add/drop column. All DDL is previewed as SQL before it runs.

Not yet built: SQL editor, query history, import/export, SSH tunnelling, command palette.

## Development

```sh
npm install
npm run tauri dev
```

### Tests

Driver and DDL integration tests run against a throwaway SQLite fixture:

```sh
cd src-tauri
TABILI_TEST_SQLITE_PATH=/path/to/fixture.sqlite cargo test
```

## Architecture

- `src-tauri/src/db/` — a `DatabaseDriver` trait with one implementation per dialect (`postgres/`, `mysql/`, `sqlite/`), each split into `introspect` / `decode` / `mutate` / `ddl`. Cell values decode into a shared `DbValue` enum; unknown types degrade to `Unsupported` rather than failing a fetch.
- `src-tauri/src/commands/` — Tauri IPC commands. Types are generated into `src/bindings.ts` via `tauri-specta`, so the frontend is typed against the Rust definitions.
- `src/` — React frontend: `components/`, `stores/` (Zustand), `hooks/` (TanStack Query).

DDL and row mutations are always built and previewed as SQL separately from execution, so nothing destructive runs without being shown first.
