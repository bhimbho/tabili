# tabili — TablePlus-gap closure plan

## Phase 1 — SQL editor: syntax highlighting + result pagination
**Goal:** Replace the plain textarea with Monaco (already a dependency) and make editor queries paginate via `fetch_more`.

1. Backend: make `run_query` return a real execution id (not `""`) so `fetch_more` works.
   - All 3 drivers currently return `execution_id: QueryExecutionId("".to_string())`.
   - Generate a `Uuid` per run in the drivers (or in `commands/query.rs`) and persist it on the driver so `fetch_more` can page.
2. Backend: implement `fetch_more` to actually page (MySQL/SQLite/Postgres) — or at minimum keep results in a driver-held buffer keyed by execution id.
3. Frontend `SqlEditor.tsx`:
   - Swap `<textarea>` for `<MonacoEditor>` from `@monaco-editor/react` (already in package.json).
   - Keep the line/col status bar (Monaco exposes cursor position).
   - Keep "Beautify" (format the Monaco value) and "Save as JSON".
   - Add a "Load more" button in the results table when `result.hasMore` is true.
- Verify: `cargo check`, `tsc`, `npm run build`.

## Phase 2 — Truncate + Drop table (destructive ops)
**Goal:** Let the user truncate or drop a table from the object panel context menu with a confirmation preview.

Backend:
- Add `truncate` to the trait or reuse `execute_ddl` with a generated statement.
  - Add `build_truncate_table_ddl` to the trait + 3 drivers (Postgres/MySQL/SQLite) returning `["TRUNCATE TABLE <q>"]`.
  - Add a `truncate_table` command that previews then executes, or add `preview_truncate_table` + reuse `execute_ddl`.
- Add commands `preview_drop_table` (reuse `build_drop_table_ddl`) — it already exists in the trait.

Frontend:
- Object panel table right-click context menu: add **Truncate…** and **Drop…**.
- Both open a `ConfirmDialog` showing the generated SQL; on confirm call `execute_ddl`.
- After success, invalidate `tables`/`rows` queries (and close the table tab if it was open).
- Verify: build both sides.

## Phase 3 — New table creation UI
**Goal:** Provide a "New Table" dialog (backend DDL already exists).

Backend:
- Add `preview_create_table` command that calls `driver.build_create_table_ddl(&spec)`.
- Reuse `execute_ddl` for execution (already exists).

Frontend:
- Add a "+ Table" button in the object panel toolbar (or context menu on the Tables group header).
- New `CreateTableDialog.tsx`: table name, a list of column rows (name, type, nullable, default), PK checkbox list; builds `TableSpec`.
- Shows generated SQL preview; on confirm `execute_ddl` then invalidate `tables` + `columns`.
- Verify: build both.

## Phase 4 — Edit column (rename / retype / default)
**Goal:** Edit an existing column's name/type/nullable/default. `TableDiff` already supports `renamed_columns`, `added_columns`, `dropped_columns` but not type/nullable/default changes.

Backend:
- Extend `TableDiff` (in `types.rs`) OR add a new `edit_column` path.
- Add `edit_column_ddl` builder to each driver: for Postgres/MySQL emit `ALTER TABLE ... ALTER COLUMN ... TYPE ...` / `SET/DROP NOT NULL` / `SET/DROP DEFAULT`. SQLite requires the table-recreate dance (reuse existing `build_alter_table_ddl` logic if present).
- Add command `preview_edit_column` + reuse `execute_ddl`.

Frontend:
- StructureView column row: add "Edit" to a context menu.
- `EditColumnDialog.tsx` pre-filled with the column's current name/type/nullable/default; show SQL preview; execute on confirm; invalidate `columns`.
- Verify: build both.

## Phase 5 — Find in results grid
**Goal:** Search/highlight text across the table grid and editor results.

Frontend-only:
- Add a "Find" toolbar input (⌘F) to `TableView` and `SqlEditor` results.
- On input, iterate visible rows, match case-insensitive substring against `displayValue`, highlight matching cells / report match count.
- Add Next/Prev to cycle matches; clear on Esc.
- Verify: `tsc` + `npm run build`.

## Phase 6 — Final build & test
- Run `cargo check`, `tsc --noEmit`, `npm run build`.
- Manually smoke-test: new connection → open table → truncate/drop → new table → edit column → run editor query → find in results.
- Commit + push.

## Notes / risks
- `@monaco-editor/react` is already a dependency (unused) — low risk to wire up.
- `fetch_more` semantics are the biggest backend risk; start with an in-memory result buffer keyed by execution id before attempting true cursor pagination.
- Truncate/drop are destructive — always route through a preview + `execute_ddl` and require confirmation.
- SQLite ALTER TABLE is limited; plan a table-recreate approach for column edits, or restrict SQLite edit-column to add/drop-only.
