# tabili

A native macOS database client. *Tabili* is Yoruba for "table".

Built with Tauri v2 (Rust) + React + TypeScript.

## Status

Early development, but usable day to day. Working today:

- **Connections** — PostgreSQL, MySQL/MariaDB and SQLite, with SSL modes and client cert/key/CA support. Connection metadata is stored locally; passwords go to the macOS Keychain and never touch disk. Saved connections persist across restarts and can be edited in place.
- **SSH tunnelling** — connect to a database that is only reachable from a bastion, with password or private-key auth. Host keys are checked against `~/.ssh/known_hosts` on a trust-on-first-use basis, and a changed key is refused.
- **Browsing** — schema/table explorer, paginated virtualized data grid, per-column filters, foreign-key navigation.
- **Editing** — inline cell editing, row insert and delete, staged as pending changes and reviewed as SQL before you commit. Enum columns get a value picker and date/time columns a picker of their own. Tables without a primary key are read-only.
- **Structure** — per-table columns, indexes, foreign keys, triggers and DDL, plus add/drop column. All DDL is previewed as SQL before it runs.
- **Import / export** — CSV, JSON and SQL export of whole tables or a chosen subset of columns; CSV and `.sql` dump import.
- **Native menus** — File/Edit/View/Connection/Tools with the usual shortcuts. Menu items whose feature is not built yet are shown disabled rather than hidden.

Not yet built: SQL editor, query history execution, command palette, backup/restore, ERD.

## Development

```sh
npm install
npm run tauri dev
```

### Packaging

```sh
npm run dmg
```

Builds a release `.app` and packages it into `src-tauri/target/release/bundle/dmg/`, then verifies the image mounts with the app inside. Tauri's own DMG step cannot run non-interactively — it drives Finder via AppleScript for the window layout — so the script invokes the bundler's `--sandbox-safe` path directly.

Builds are ad-hoc signed. macOS will refuse to open one transferred to another machine ("tabili is damaged") until the quarantine attribute is cleared:

```sh
xattr -cr /Applications/tabili.app
```

Distributing without that step requires a Developer ID signature and notarization.

### Tests

Driver, DDL and export/import integration tests run against a throwaway SQLite fixture:

```sh
cd src-tauri
TABILI_TEST_SQLITE_PATH=/path/to/fixture.sqlite cargo test
```

Postgres and MySQL have no fixture in the suite; those drivers are covered by compilation and by unit tests over the dialect-specific parsing (filters, enum labels, SQL splitting).

## Architecture

- `src-tauri/src/db/` — a `DatabaseDriver` trait with one implementation per dialect (`postgres/`, `mysql/`, `sqlite/`), each split into `introspect` / `decode` / `mutate` / `ddl`. Cell values decode into a shared `DbValue` enum; unknown types degrade to `Unsupported` rather than failing a fetch.
- `src-tauri/src/commands/` — Tauri IPC commands. Types are generated into `src/bindings.ts` via `tauri-specta`, so the frontend is typed against the Rust definitions. **The bindings regenerate when the app runs, not at `cargo build` time.**
- `src-tauri/src/ssh_tunnel.rs` — a local port forward over a russh `direct-tcpip` channel, kept alive by a keepalive heartbeat and torn down with the connection that owns it.
- `src-tauri/src/export.rs`, `import.rs`, `sql/splitter.rs` — row export/import, and a statement splitter that respects string literals, quoted identifiers, comments and dollar-quoted bodies.
- `src/` — React frontend: `components/`, `stores/` (Zustand), `hooks/` (TanStack Query).

DDL and row mutations are always built and previewed as SQL separately from execution, so nothing destructive runs without being shown first.

## Licence

MIT — see [LICENSE](LICENSE).
