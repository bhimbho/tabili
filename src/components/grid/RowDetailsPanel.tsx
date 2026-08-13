import { useState } from "react";
import type { ColumnInfo, DbValue } from "../../bindings";
import { KeyIcon } from "../ui/icons";
import type { FkMap } from "../../stores/detailsStore";

interface RowDetailsPanelProps {
  width: number;
  row: Record<string, DbValue> | null;
  columnInfos: ColumnInfo[];
  columns: string[];
  foreignKeys: FkMap;
  onFollowForeignKey: (target: { table: string; column: string }, value: DbValue) => void;
  onClose: () => void;
}

function display(value: DbValue | undefined): string {
  if (!value) return "";
  switch (value.type) {
    case "Null":
      return "NULL";
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
      return "<binary>";
    case "Json":
      return JSON.stringify(value.value, null, 2);
    case "Array":
      return JSON.stringify(value.value);
    case "Unsupported":
      return value.value.raw;
    default:
      return "";
  }
}

/** Long text and JSON are unreadable in a grid cell, so they expand here instead. */
function isMultiline(value: DbValue | undefined) {
  if (!value) return false;
  if (value.type === "Json") return true;
  return value.type === "Text" && value.value.length > 60;
}

export function RowDetailsPanel({
  width,
  row,
  columnInfos,
  columns,
  foreignKeys,
  onFollowForeignKey,
  onClose,
}: RowDetailsPanelProps) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const shown = columns.filter((c) => !needle || c.toLowerCase().includes(needle));

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col border-l border-neutral-800 bg-neutral-900"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-neutral-800 px-3">
        <span className="text-xs font-semibold text-neutral-200">Details</span>
        <button
          onClick={onClose}
          title="Hide details"
          className="rounded px-1.5 text-xs text-neutral-500 transition-colors hover:text-neutral-200"
        >
          ×
        </button>
      </div>

      {!row ? (
        <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-neutral-600">
          No row selected
        </div>
      ) : (
        <>
          <div className="shrink-0 px-3 py-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search for field…"
              className="w-full rounded-md border border-black/30 bg-black/20 px-2 py-1 text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-500 focus:border-neutral-500"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {shown.map((name) => {
              const info = columnInfos.find((c) => c.name === name);
              const value = row[name];
              const fk = foreignKeys[name];
              const linkable = fk && value && value.type !== "Null";

              return (
                <div key={name} className="mb-3">
                  <div className="mb-1 flex items-baseline gap-1.5">
                    {info?.isPrimaryKey && <KeyIcon className="h-2.5 w-2.5 text-amber-500" />}
                    <span className="text-xs font-medium text-neutral-300">{name}</span>
                    <span className="ml-auto font-mono text-[10px] text-neutral-600">
                      {info?.dataType}
                    </span>
                  </div>

                  {linkable ? (
                    <button
                      onClick={() => onFollowForeignKey(fk, value)}
                      title={`Go to ${fk.table}.${fk.column}`}
                      className="selectable flex w-full items-center justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-left text-xs text-neutral-200 transition-colors hover:border-neutral-600 hover:bg-neutral-800"
                    >
                      <span className="truncate">{display(value)}</span>
                      <span className="shrink-0 text-[10px] text-neutral-500">
                        {fk.table}.{fk.column} →
                      </span>
                    </button>
                  ) : isMultiline(value) ? (
                    <pre className="selectable max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 font-mono text-[11px] text-neutral-300">
                      {display(value)}
                    </pre>
                  ) : (
                    <div
                      className={`selectable truncate rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-xs ${
                        value?.type === "Null" ? "text-neutral-600 italic" : "text-neutral-200"
                      }`}
                    >
                      {display(value)}
                    </div>
                  )}
                </div>
              );
            })}
            {shown.length === 0 && <p className="text-xs text-neutral-600">No matching fields.</p>}
          </div>
        </>
      )}
    </aside>
  );
}
