import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import Editor, { type OnMount } from "@monaco-editor/react";
import { format as formatSql } from "sql-formatter";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { commands, type DbValue, type QueryHandle } from "../../bindings";
import { friendlyError } from "../../lib/errors";
import { useConsoleStore } from "../../stores/consoleStore";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { useThemeStore } from "../../stores/themeStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../ui/ContextMenu";

function displayValue(value: DbValue | undefined): string {
  if (!value) return "";
  switch (value.type) {
    case "Null":
      return "";
    case "Default":
      return "DEFAULT";
    case "Now":
      return "CURRENT_TIMESTAMP";
    case "Bool":
      return value.value ? "true" : "false";
    case "Int":
    case "Float":
      return String(value.value);
    case "Decimal":
    case "Text":
    case "DateTime":
    case "Uuid":
      return value.value;
    case "Bytes":
      return "<blob>";
    case "Json":
      return JSON.stringify(value.value);
    case "Array":
      return `[${value.value.length} items]`;
    case "Unsupported":
      return value.value.raw;
    default:
      return "";
  }
}

interface SqlEditorProps {
  connectionId: string;
}

export function SqlEditor({ connectionId }: SqlEditorProps) {
  const [sql, setSql] = useState("");
  const [running, setRunning] = useState(false);
  const [handle, setHandle] = useState<QueryHandle | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, DbValue>[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [editorHeight, setEditorHeight] = useState(220);
  const [find, setFind] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [menuCell, setMenuCell] = useState<{ row: Record<string, DbValue>; column: string } | null>(null);
  const [selectedRowIdx, setSelectedRowIdx] = useState<number | null>(null);
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const menu = useContextMenu();
  const log = useConsoleStore((s) => s.log);
  const themeMode = useThemeStore((s) => s.mode);

  const connections = useConnectionsStore((s) => s.connections);
  const dialect = connections.find((c) => c.id === connectionId)?.dialect ?? "Postgres";

  const formatterLanguage =
    dialect === "MySql" ? "mysql" : dialect === "Sqlite" ? "sqlite" : "postgresql";

  const lineCount = useMemo(() => (sql ? sql.split("\n").length : 1), [sql]);
  const charCount = sql.length;

  function onDragStart(e: React.PointerEvent) {
    dragRef.current = { startY: e.clientY, startHeight: editorHeight };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    const onMove = (ev: PointerEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientY - dragRef.current.startY;
      setEditorHeight(Math.min(600, Math.max(80, dragRef.current.startHeight + delta)));
    };
    const onUp = () => {
      dragRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }

  const handleEditorMount: OnMount = (editor, monaco) => {
    editorRef.current = editor;
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void runCurrent());
    editor.onDidChangeCursorPosition((e) => {
      setCursor({ line: e.position.lineNumber, col: e.position.column });
    });
  };

  async function runStatement(statement: string) {
    const trimmed = statement.trim();
    if (!trimmed || !connectionId) return;
    setRunning(true);
    setError(null);
    const started = performance.now();
    const res = await commands.runQuery(connectionId, trimmed);
    const durationMs = Math.round(performance.now() - started);
    if (res.status === "error") {
      const msg = friendlyError(res.error.message);
      setError(msg);
      log({ sql: trimmed, success: false, error: msg, durationMs });
      setHandle(null);
      setColumns([]);
      setRows([]);
      setHasMore(false);
    } else {
      const h = res.data;
      setHandle(h);
      setColumns(h.firstPage.columns);
      setRows(h.firstPage.rows);
      setHasMore(h.firstPage.hasMore);
      log({ sql: trimmed, success: true, durationMs });
    }
    setRunning(false);
  }

  async function runAll() {
    if (!sql.trim()) return;
    const statements = await commands.splitSql(sql);
    if (statements.length === 0) return;
    for (const stmt of statements) {
      await runStatement(stmt);
    }
  }

  async function runCurrent() {
    if (!sql.trim()) return;
    const statements = await commands.splitSql(sql);
    if (statements.length === 0) return;
    const caret = editorRef.current?.getPosition();
    const text = editorRef.current?.getValue() ?? sql;
    const caretOffset = caret
      ? text.split("\n").slice(0, caret.lineNumber - 1).join("\n").length + (caret.column - 1)
      : 0;
    let offset = 0;
    let current: string | null = null;
    for (const stmt of statements) {
      const start = sql.indexOf(stmt, offset);
      if (start === -1) continue;
      const end = start + stmt.length;
      if (caretOffset >= start && caretOffset <= end) {
        current = stmt;
        break;
      }
      offset = end;
    }
    await runStatement(current ?? statements[statements.length - 1]);
  }

  function beautify() {
    if (!sql.trim()) return;
    try {
      setSql(formatSql(sql, { language: formatterLanguage }));
    } catch (e) {
      setError(`Could not format SQL: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function loadMore() {
    if (!handle || !hasMore) return;
    const next = await commands.fetchMore(connectionId, handle.executionId, rows.length);
    if (next.status === "error") {
      setError(friendlyError(next.error.message));
      return;
    }
    setRows((prev) => [...prev, ...next.data.rows]);
    setHasMore(next.data.hasMore);
  }

  async function saveAsJson() {
    const path = await saveFileDialog({
      defaultPath: "query.json",
      filters: [{ name: "JSON", extensions: ["json"] }],
    });
    if (!path) return;
    const payload = JSON.stringify({ sql, dialect, savedAt: new Date().toISOString() }, null, 2);
    const res = await commands.saveSqlFile(path, payload);
    if (res.status === "error") {
      setError(friendlyError(res.error.message));
    }
  }

  const cellMenuItems: MenuEntry[] = [
    {
      label: "Copy cell value",
      onSelect: () => {
        if (menuCell) navigator.clipboard.writeText(displayValue(menuCell.row[menuCell.column]));
      },
    },
    {
      label: "Copy column value",
      onSelect: () => {
        if (menuCell) {
          navigator.clipboard.writeText(displayValue(menuCell.row[menuCell.column]));
        }
      },
    },
    {
      label: "Copy row (JSON)",
      onSelect: () => {
        if (menuCell) navigator.clipboard.writeText(JSON.stringify(menuCell.row, null, 2));
      },
    },
    null,
    {
      label: "Details…",
      onSelect: () => {
        if (menuCell) {
          const idx = rows.findIndex((r) => r === menuCell.row);
          setSelectedRowIdx(idx >= 0 ? idx : null);
        }
      },
    },
  ];

  async function exportResult(format: "csv" | "json") {
    if (rows.length === 0) return;
    const path = await saveFileDialog({
      defaultPath: `query-result.${format}`,
      filters: [{ name: format.toUpperCase(), extensions: [format] }],
    });
    if (!path) return;
    const res = await commands.exportQueryResult(path, columns, rows, format);
    if (res.status === "error") {
      setError(friendlyError(res.error.message));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-(--border) px-2 py-1.5">
        <button
          onClick={runCurrent}
          disabled={running || !sql.trim()}
          className="rounded-md bg-(--accent) px-2.5 py-1 text-xs font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Running…" : "Run current"}
        </button>
        <button
          onClick={runAll}
          disabled={running || !sql.trim()}
          className="rounded-md bg-(--active) px-2.5 py-1 text-xs font-medium text-(--text) transition-colors hover:bg-(--hover) disabled:cursor-not-allowed disabled:opacity-40"
        >
          Run all
        </button>
        <button
          onClick={beautify}
          disabled={!sql.trim()}
          className="rounded-md bg-(--active) px-2.5 py-1 text-xs font-medium text-(--text) transition-colors hover:bg-(--hover) disabled:cursor-not-allowed disabled:opacity-40"
        >
          Beautify
        </button>
        <button
          onClick={saveAsJson}
          disabled={!sql.trim()}
          className="rounded-md bg-(--active) px-2.5 py-1 text-xs font-medium text-(--text) transition-colors hover:bg-(--hover) disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save as JSON
        </button>
        <button
          onClick={() => setFindOpen((o) => !o)}
          disabled={rows.length === 0}
          className="rounded-md bg-(--active) px-2.5 py-1 text-xs font-medium text-(--text) transition-colors hover:bg-(--hover) disabled:cursor-not-allowed disabled:opacity-40"
        >
          Find
        </button>
        <button
          onClick={() => void exportResult("csv")}
          disabled={rows.length === 0}
          className="rounded-md bg-(--active) px-2.5 py-1 text-xs font-medium text-(--text) transition-colors hover:bg-(--hover) disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export CSV
        </button>
        <button
          onClick={() => void exportResult("json")}
          disabled={rows.length === 0}
          className="rounded-md bg-(--active) px-2.5 py-1 text-xs font-medium text-(--text) transition-colors hover:bg-(--hover) disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export JSON
        </button>
        {rows.length > 0 && (
          <span className="ml-auto text-[11px] text-(--text-faint)">
            {rows.length} row{rows.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Monaco editor */}
      <div className="flex shrink-0 flex-col overflow-hidden border-b border-(--border)" style={{ height: editorHeight }}>
        <div className="min-h-0 flex-1">
          <Editor
            height="100%"
            language="sql"
            value={sql}
            onChange={(v) => setSql(v ?? "")}
            onMount={handleEditorMount}
            theme={themeMode === "light" ? "vs" : "vs-dark"}
            options={{
              minimap: { enabled: false },
              fontSize: 12,
              fontFamily: "'SF Mono', 'Menlo', monospace",
              scrollBeyondLastLine: false,
              automaticLayout: true,
              lineNumbers: "on",
              wordWrap: "on",
              padding: { top: 8, bottom: 8 },
              renderLineHighlight: "line",
            }}
          />
        </div>

        {/* Status bar */}
        <div className="flex shrink-0 items-center gap-3 border-t border-(--border) px-2 py-1 text-[11px] text-(--text-faint)">
          <span>
            Ln {cursor.line}, Col {cursor.col}
          </span>
          <span>{charCount} chars</span>
          <span>{lineCount} lines</span>
        </div>
      </div>

      {/* Drag handle to expand/collapse the editor */}
      <div
        onPointerDown={onDragStart}
        onDoubleClick={() => setEditorHeight(220)}
        className="group relative h-1.5 shrink-0 cursor-row-resize bg-transparent"
        title="Drag to resize editor · double-click to reset"
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-(--border) transition-colors group-hover:bg-(--accent)" />
      </div>

      {/* Find bar */}
      {findOpen && (
        <div className="flex shrink-0 items-center gap-2 border-b border-(--border) bg-(--hover) px-2 py-1">
          <input
            autoFocus
            value={find}
            onChange={(e) => setFind(e.target.value)}
            placeholder="Find in results…"
            className="min-w-0 flex-1 rounded-md border border-(--border) bg-(--surface-sunken) px-2 py-1 text-xs text-(--text) outline-none placeholder:text-(--text-faint) focus:border-(--accent)"
          />
          <button
            onClick={() => setFind("")}
            className="rounded px-1 text-(--text-faint) hover:text-(--text-muted)"
            title="Clear"
          >
            ×
          </button>
        </div>
      )}

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p className="px-3 py-2 text-xs text-(--danger)">{error}</p>}
        {!error && rows.length === 0 && (
          <p className="px-3 py-2 text-xs text-(--text-faint)">Run a query to see results.</p>
        )}
        {!error && columns.length === 0 && handle && (
          <p className="px-3 py-2 text-xs text-(--text-muted)">Statement executed successfully.</p>
        )}
        {!error && columns.length > 0 && (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="sticky top-0 bg-(--surface-raised)">
                {columns.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap border-b border-(--border) px-2 py-1 text-left font-medium text-(--text-muted)"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={i}
                  onClick={() => setSelectedRowIdx(selectedRowIdx === i ? null : i)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenuCell({ row, column: columns[0] });
                    menu.open(e);
                  }}
                  className={clsx(
                    "cursor-pointer transition-colors",
                    i % 2 === 1 && "bg-(--hover)",
                    selectedRowIdx === i && "bg-indigo-600/15",
                  )}
                >
                  {columns.map((c) => {
                    const text = displayValue(row[c]);
                    const matches = find.trim() && text.toLowerCase().includes(find.trim().toLowerCase());
                    return (
                      <td
                        key={c}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMenuCell({ row, column: c });
                          menu.open(e);
                        }}
                        className={clsx(
                          "whitespace-nowrap border-b border-(--grid-line) px-2 py-1",
                          matches ? "bg-amber-500/20 text-amber-300" : "text-(--text-muted)",
                        )}
                      >
                        {text}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {hasMore && (
          <div className="flex justify-center py-2">
            <button
              onClick={loadMore}
              className="rounded-md bg-(--active) px-3 py-1 text-xs font-medium text-(--text) transition-colors hover:bg-(--hover)"
            >
              Load more
            </button>
          </div>
        )}

        {/* Row details */}
        {selectedRowIdx !== null && rows[selectedRowIdx] && (
          <div className="shrink-0 border-t border-(--border) bg-(--hover) p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-(--text)">Row {selectedRowIdx + 1}</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() =>
                    navigator.clipboard.writeText(JSON.stringify(rows[selectedRowIdx], null, 2))
                  }
                  className="rounded px-1.5 py-0.5 text-[11px] text-(--text-muted) transition-colors hover:bg-(--active) hover:text-(--text)"
                >
                  Copy JSON
                </button>
                <button
                  onClick={() => setSelectedRowIdx(null)}
                  className="rounded px-1.5 text-xs text-(--text-faint) transition-colors hover:text-(--text-muted)"
                >
                  ×
                </button>
              </div>
            </div>
            <div className="grid max-h-40 grid-cols-2 gap-x-3 overflow-y-auto">
              {columns.map((c) => (
                <div key={c} className="flex items-baseline gap-2 border-b border-(--grid-line) py-1">
                  <span className="shrink-0 font-mono text-[10px] text-(--text-faint)">{c}</span>
                  <span
                    className="selectable min-w-0 truncate text-xs text-(--text)"
                    title={displayValue(rows[selectedRowIdx][c])}
                  >
                    {displayValue(rows[selectedRowIdx][c])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <ContextMenu position={menu.position} items={cellMenuItems} onClose={menu.close} />
    </div>
  );
}
