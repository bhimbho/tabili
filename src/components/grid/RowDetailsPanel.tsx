import { useState } from "react";
import type { ColumnInfo, DbValue } from "../../bindings";
import { KeyIcon } from "../ui/icons";
import type { FkMap } from "../../stores/detailsStore";
import { useChangesStore, pkKeyOf } from "../../stores/changesStore";
import { EnumField } from "./EnumField";
import { DateTimeField, dateTimeKind } from "./DateTimeField";
import { TableDetailsPanel } from "./TableDetailsPanel";

interface RowDetailsPanelProps {
  width: number;
  row: Record<string, DbValue> | null;
  columnInfos: ColumnInfo[];
  columns: string[];
  foreignKeys: FkMap;
  onFollowForeignKey: (target: { table: string; column: string }, value: DbValue) => void;
  onClose: () => void;
  /** Present when the row can be written to; absent makes the pane read-only. */
  edit?: { connectionId: string; schema: string | null; table: string };
}

function display(value: DbValue | undefined): string {
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

/** Mirrors the grid's parsing so an edit means the same thing in either place. */
function parseEdited(original: DbValue | undefined, text: string): DbValue {
  if (text === "") return { type: "Null" };
  switch (original?.type ?? "Text") {
    case "Bool":
      return { type: "Bool", value: text.trim().toLowerCase() === "true" };
    case "Int": {
      const n = parseInt(text, 10);
      return Number.isNaN(n) ? { type: "Text", value: text } : { type: "Int", value: n };
    }
    case "Float": {
      const n = parseFloat(text);
      return Number.isNaN(n) ? { type: "Text", value: text } : { type: "Float", value: n };
    }
    case "Decimal":
      return { type: "Decimal", value: text };
    case "DateTime":
      return { type: "DateTime", value: text };
    case "Uuid":
      return { type: "Uuid", value: text };
    default:
      return { type: "Text", value: text };
  }
}

function isEditable(value: DbValue | undefined) {
  if (!value) return true;
  return !["Bytes", "Array", "Unsupported"].includes(value.type);
}

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
  edit,
}: RowDetailsPanelProps) {
  const [search, setSearch] = useState("");
  const edits = useChangesStore((s) => s.edits);
  const setEdit = useChangesStore((s) => s.setEdit);

  const needle = search.trim().toLowerCase();
  const shown = columns.filter((c) => !needle || c.toLowerCase().includes(needle));

  const pkColumns = columnInfos.filter((c) => c.isPrimaryKey).map((c) => c.name);
  const canEdit = !!edit && pkColumns.length > 0 && !!row;
  const pk = row ? Object.fromEntries(pkColumns.map((c) => [c, row[c]])) : {};
  const pkKey = row && pkColumns.length > 0 ? pkKeyOf(pk) : "";

  function stagedFor(column: string): DbValue | undefined {
    if (!edit || !pkKey) return undefined;
    return edits.get(`${edit.connectionId}:${edit.table}:${pkKey}:${column}`)?.newValue;
  }

  function commitValue(column: string, newValue: DbValue) {
    if (!edit || !row) return;
    setEdit({
      connectionId: edit.connectionId,
      table: edit.table,
      schema: edit.schema,
      pk,
      column,
      oldValue: row[column] ?? { type: "Null" },
      newValue,
    });
  }

  function commitField(column: string, text: string) {
    if (!row) return;
    commitValue(column, parseEdited(row[column], text));
  }

  const fieldBase =
    "selectable w-full rounded-md border border-(--border) bg-(--surface-sunken) px-2 py-1 text-xs text-(--text) outline-none transition-colors focus:border-(--accent)";

  return (
    <aside
      style={{ width }}
      className="flex shrink-0 flex-col border-l border-(--border) bg-(--surface)"
    >
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-(--border) px-3">
        <span className="text-xs font-semibold text-(--text)">Details</span>
        <button
          onClick={onClose}
          title="Hide details"
          className="rounded px-1.5 text-xs text-(--text-faint) transition-colors hover:text-(--text-muted)"
        >
          ×
        </button>
      </div>

      {/* With no row picked, describe the table rather than showing an empty pane. */}
      {!row ? (
        edit ? (
          <TableDetailsPanel
            connectionId={edit.connectionId}
            schema={edit.schema}
            table={edit.table}
            columnInfos={columnInfos}
          />
        ) : (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-xs text-(--text-faint)">
            No table open
          </div>
        )
      ) : (
        <>
          <div className="shrink-0 px-3 py-2">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search for field…"
              className="w-full rounded-md border border-(--border) bg-(--surface-sunken) px-2 py-1 text-xs text-(--text) outline-none transition-colors placeholder:text-(--text-faint) focus:border-(--accent)"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {!canEdit && edit && (
              <p className="mb-2 rounded-md border border-amber-900/40 bg-amber-950/20 px-2 py-1 text-[11px] text-amber-500">
                No primary key — this row can't be edited.
              </p>
            )}

            {shown.map((name) => {
              const info = columnInfos.find((c) => c.name === name);
              const staged = stagedFor(name);
              const value = staged ?? row[name];
              const fk = foreignKeys[name];
              const linkable = fk && value && value.type !== "Null";
              const editable = canEdit && isEditable(row[name]);
              const dirty = staged !== undefined;
              // Remount the uncontrolled input when the underlying value changes
              // (row switch, commit, discard) so it never shows a stale edit.
              const fieldKey = `${pkKey}:${name}:${display(value)}`;

              return (
                <div key={name} className="mb-3">
                  <div className="mb-1 flex items-baseline gap-1.5">
                    {info?.isPrimaryKey && <KeyIcon className="h-2.5 w-2.5 text-amber-500" />}
                    <span className="text-xs font-medium text-(--text-muted)">{name}</span>
                    {dirty && <span className="text-[10px] text-amber-500">edited</span>}
                    <span className="ml-auto font-mono text-[10px] text-(--text-faint)">
                      {info?.dataType}
                    </span>
                  </div>

                  {info && dateTimeKind(info.dataType) ? (
                    <DateTimeField
                      value={value}
                      kind={dateTimeKind(info.dataType)!}
                      nullable={info.nullable}
                      hasDefault={info.defaultValue != null}
                      dirty={dirty}
                      disabled={!canEdit}
                      onChange={(next) => commitValue(name, next)}
                    />
                  ) : info && info.enumValues.length > 0 ? (
                    <EnumField
                      value={value}
                      options={info.enumValues}
                      nullable={info.nullable}
                      hasDefault={info.defaultValue != null}
                      dirty={dirty}
                      disabled={!canEdit}
                      onChange={(next) => commitValue(name, next)}
                    />
                  ) : linkable ? (
                    <div className="flex gap-1">
                      {editable ? (
                        <input
                          key={fieldKey}
                          defaultValue={display(value)}
                          onBlur={(e) => commitField(name, e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                          className={`${fieldBase} ${
                            dirty
                              ? "border-amber-700/60 text-amber-300"
                              : "border-(--border) text-(--text)"
                          }`}
                        />
                      ) : (
                        <div className={`${fieldBase} text-(--text)`}>
                          {display(value)}
                        </div>
                      )}
                      <button
                        onClick={() => onFollowForeignKey(fk, value)}
                        title={`Go to ${fk.table}.${fk.column}`}
                        className="shrink-0 rounded-md border border-(--border) px-2 text-xs text-(--text-muted) transition-colors hover:border-(--border-strong) hover:bg-(--hover) hover:text-(--text)"
                      >
                        →
                      </button>
                    </div>
                  ) : isMultiline(row[name]) ? (
                    editable ? (
                      <textarea
                        key={fieldKey}
                        defaultValue={display(value)}
                        onBlur={(e) => commitField(name, e.target.value)}
                        rows={5}
                        className={`${fieldBase} resize-y font-mono text-[11px] ${
                          dirty
                            ? "border-amber-700/60 text-amber-300"
                            : "border-(--border) text-(--text-muted)"
                        }`}
                      />
                    ) : (
                      <pre className="selectable max-h-40 overflow-auto whitespace-pre-wrap rounded-md border border-(--border) bg-(--surface-sunken) px-2 py-1 font-mono text-[11px] text-(--text-muted)">
                        {display(value)}
                      </pre>
                    )
                  ) : editable ? (
                    <input
                      key={fieldKey}
                      defaultValue={display(value)}
                      onBlur={(e) => commitField(name, e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
                      placeholder={value?.type === "Null" ? "NULL" : undefined}
                      className={`${fieldBase} ${
                        dirty
                          ? "border-amber-700/60 text-amber-300"
                          : "border-(--border) text-(--text)"
                      } placeholder:italic placeholder:text-(--text-faint)`}
                    />
                  ) : (
                    <div
                      className={`${fieldBase} truncate ${
                        value?.type === "Null" ? "italic text-(--text-faint)" : "text-(--text)"
                      }`}
                    >
                      {value?.type === "Null" ? "NULL" : display(value)}
                    </div>
                  )}
                </div>
              );
            })}
            {shown.length === 0 && <p className="text-xs text-(--text-faint)">No matching fields.</p>}
          </div>
        </>
      )}
    </aside>
  );
}
