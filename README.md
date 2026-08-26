# Tabili

A native macOS database client. *Tabili* is Yoruba for "table".

<p align="center">
  <img src="docs/readme-preview.png" width="480" alt="Tabili">
</p>

Built with Tauri v2 (Rust) + React + TypeScript.

## Status

Early development, but usable day to day. Working today:

- **Connections** — PostgreSQL, MySQL/MariaDB and SQLite, with SSL modes and client cert/key/CA support. Connection metadata is stored locally; passwords go to the macOS Keychain and never touch disk. Saved connections persist across restarts and can be edited in place.
- **SSH tunnelling** — connect to a database that is only reachable from a bastion, with password or private-key auth. Host keys are checked against `~/.ssh/known_hosts` on a trust-on-first-use basis, and a changed key is refused.
- **Browsing** — schema/table explorer, paginated virtualized data grid, per-column filters, foreign-key navigation.
- **Editing** — inline cell editing, row insert and delete, staged as pending changes and reviewed as SQL before you commit. Enum columns get a value picker and date/time columns a picker of their own. Tables without a primary key are read-only.
- **Structure** — per-table columns, indexes, foreign keys, triggers and DDL, plus add/drop/edit column, create index and create trigger. All DDL is previewed as SQL before it runs.
- **SQL editor** — a Monaco-based editor with syntax highlighting, run-current / run-all, beautify, result pagination, copy cell/column/row, export results to CSV or JSON, and find-in-results.
- **Queries & history** — statement history and saved queries, plus a live console (⌘J).
- **Import / export** — CSV, JSON and SQL export of whole tables or a chosen subset of columns; CSV and `.sql` dump import.
- **Native menus** — File/Edit/View/Connection/Tools with the usual shortcuts. Menu items whose feature is not built yet are shown disabled rather than hidden.

Not yet built: command palette, backup/restore, ERD.

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

The DMG includes a **one-click installer** (`Install tabili.command`) that copies
the app to `/Applications`, clears the quarantine attribute, and opens it — so
recipients of an unsigned build don't need to touch a terminal.

For an unsigned (ad-hoc signed) build, macOS still sets a quarantine attribute
that Gatekeeper refuses to open without clearing:

```sh
xattr -cr /Applications/tabili.app
```

The one-click installer above does this automatically. Distributing without any
quarantine friction at all requires a Developer ID signature and notarization,
which the script performs automatically when `APPLE_SIGNING_IDENTITY` (and the
notarization credentials) are set.

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

## Contributing

Thanks for your interest in Tabili! Here's how to get involved.

### Setting up

```sh
git clone https://github.com/bhimbho/tabili.git
cd tabili
npm install
npm run tauri dev
```

You'll need the [Rust toolchain](https://rustup.rs) and a recent Node.js. The dev
server launches the app with live reload — Rust changes trigger a rebuild, and
frontend changes hot-reload in place.

### Finding something to work on

- Browse the [open issues](https://github.com/bhimbho/tabili/issues) — anything
  tagged `good first issue` is a great starting point.
- Not-yet-built features are listed above under *Status*; pull requests are
  welcome for any of them.
- If a feature is marked disabled in the native menus (Tools, etc.), that's an
  explicit placeholder for work still to come.

### Making changes

- **Backend** lives in `src-tauri/src/`. Tauri IPC commands go in
  `commands/`; per-dialect database logic in `db/` (`postgres/`, `mysql/`,
  `sqlite/`, each split into `introspect` / `decode` / `mutate` / `ddl`).
- **Frontend** lives in `src/`: components under `components/`, Zustand stores
  under `stores/`, and TanStack Query hooks under `hooks/`.
- **Bindings** (`src/bindings.ts`) are generated by `tauri-specta` when the app
  runs — don't hand-edit them; the code generator owns that file.

Follow the existing style: comments explain *why* more often than *what*, and
destructive operations are always previewed as SQL before they execute.

### Before submitting a pull request

- Run the tests:
  ```bash
  cd src-tauri
  cargo test --lib
  # integration tests need a SQLite fixture:
  TABILI_TEST_SQLITE_PATH=/path/to/fixture.sqlite cargo test
  ```
- Make sure both sides compile:
  ```bash
  npm run build        # tsc + vite build
  cargo check -p tabili --manifest-path src-tauri/Cargo.toml
  ```
- Commit in small, focused steps. Write a clear commit message describing the
  *why* of the change.

Open a PR against `main` and reference any related issue. Thanks for
contributing!

## License

MIT — see [LICENSE](LICENSE).

Built with [Tauri v2](https://tauri.app), [React](https://react.dev), and
[sqlx](https://github.com/launchbadge/sqlx).
