import { useMemo, useRef, useState } from "react";
import clsx from "clsx";
import { format as formatSql } from "sql-formatter";
import { save as saveFileDialog } from "@tauri-apps/plugin-dialog";
import { commands, type DbValue, type RowPage } from "../../bindings";
import { friendlyError } from "../../lib/errors";
import { useConsoleStore } from "../../stores/consoleStore";
import { useConnectionsStore } from "../../stores/connectionsStore";

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
  const [result, setResult] = useState<RowPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState({ line: 1, col: 1 });
  const [editorHeight, setEditorHeight] = useState(180);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const log = useConsoleStore((s) => s.log);

  const connections = useConnectionsStore((s) => s.connections);
  const dialect = connections.find((c) => c.id === connectionId)?.dialect ?? "Postgres";

  const formatterLanguage =
    dialect === "MySql" ? "mysql" : dialect === "Sqlite" ? "sqlite" : "postgresql";

  const lineCount = useMemo(() => (sql ? sql.split("\n").length : 1), [sql]);
  const charCount = sql.length;

  function updateCursor() {
    const el = textareaRef.current;
    if (!el) return;
    const upToCursor = el.value.slice(0, el.selectionStart);
    const lines = upToCursor.split("\n");
    setCursor({ line: lines.length, col: lines[lines.length - 1].length + 1 });
  }

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
      setResult(null);
    } else {
      setResult(res.data.firstPage);
      log({ sql: trimmed, success: true, durationMs });
    }
    setRunning(false);
  }

  async function runAll() {
    if (!sql.trim()) return;
    const statements = await commands.splitSql(sql);
    if (statements.length === 0) return;
    // Run them sequentially, keeping the last result visible.
    for (const stmt of statements) {
      await runStatement(stmt);
    }
  }

  async function runCurrent() {
    if (!sql.trim()) return;
    const statements = await commands.splitSql(sql);
    if (statements.length === 0) return;

    // Find the statement whose range contains the cursor.
    const el = textareaRef.current;
    const caret = el ? el.selectionStart : 0;
    let offset = 0;
    let current: string | null = null;
    for (const stmt of statements) {
      const start = sql.indexOf(stmt, offset);
      if (start === -1) continue;
      const end = start + stmt.length;
      if (caret >= start && caret <= end) {
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-black/30 px-2 py-1.5">
        <button
          onClick={runCurrent}
          disabled={running || !sql.trim()}
          className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {running ? "Running…" : "Run current"}
        </button>
        <button
          onClick={runAll}
          disabled={running || !sql.trim()}
          className="rounded-md bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Run all
        </button>
        <button
          onClick={beautify}
          disabled={!sql.trim()}
          className="rounded-md bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Beautify
        </button>
        <button
          onClick={saveAsJson}
          disabled={!sql.trim()}
          className="rounded-md bg-neutral-800 px-2.5 py-1 text-xs font-medium text-neutral-200 transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
        >
          Save as JSON
        </button>
        {result && (
          <span className="ml-auto text-[11px] text-neutral-500">
            {result.rows.length} row{result.rows.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Editor with line gutter */}
      <div className="flex shrink-0 flex-col" style={{ height: editorHeight }}>
        <div className="flex min-h-0 flex-1">
          <div
            aria-hidden
            className="select-none overflow-hidden border-r border-black/30 bg-black/10 px-2 py-2 text-right font-mono text-xs leading-[1.5] text-neutral-600"
            style={{ width: `${Math.max(3, String(lineCount).length + 1)}ch` }}
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            value={sql}
            onChange={(e) => {
              setSql(e.target.value);
              updateCursor();
            }}
            onKeyUp={updateCursor}
            onClick={updateCursor}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                void runCurrent();
              }
            }}
            placeholder="Write SQL here…  (⌘/Ctrl + Enter to run current)"
            spellCheck={false}
            className="min-w-0 flex-1 resize-none bg-transparent p-2 font-mono text-xs leading-[1.5] text-neutral-200 outline-none placeholder:text-neutral-600"
          />
        </div>

        {/* Status bar */}
        <div className="flex shrink-0 items-center gap-3 border-t border-black/30 px-2 py-1 text-[11px] text-neutral-500">
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
        onDoubleClick={() => setEditorHeight(180)}
        className="group relative h-1.5 shrink-0 cursor-row-resize bg-transparent"
        title="Drag to resize editor · double-click to reset"
      >
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-black/40 transition-colors group-hover:bg-indigo-500" />
      </div>

      {/* Results */}
      <div className="min-h-0 flex-1 overflow-auto">
        {error && <p className="px-3 py-2 text-xs text-red-400">{error}</p>}
        {!error && !result && (
          <p className="px-3 py-2 text-xs text-neutral-600">Run a query to see results.</p>
        )}
        {!error && result && result.columns.length === 0 && (
          <p className="px-3 py-2 text-xs text-neutral-500">Statement executed successfully.</p>
        )}
        {!error && result && result.columns.length > 0 && (
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="sticky top-0 bg-neutral-900">
                {result.columns.map((c) => (
                  <th
                    key={c}
                    className="whitespace-nowrap border-b border-black/40 px-2 py-1 text-left font-medium text-neutral-400"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {result.rows.map((row, i) => (
                <tr key={i} className={clsx(i % 2 === 1 && "bg-white/[0.02]")}>
                  {result.columns.map((c) => (
                    <td
                      key={c}
                      className="whitespace-nowrap border-b border-black/20 px-2 py-1 text-neutral-300"
                    >
                      {displayValue(row[c])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
