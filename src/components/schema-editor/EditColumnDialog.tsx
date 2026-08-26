import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands, type ColumnInfo } from "../../bindings";
import { friendlyError } from "../../lib/errors";
import { Select } from "../ui/Select";

interface EditColumnDialogProps {
  connectionId: string;
  table: string;
  schema: string | null;
  /** Non-null opens the dialog for that column. */
  column: ColumnInfo | null;
  onClose: () => void;
}

const COMMON_TYPES = [
  { value: "text", label: "text" },
  { value: "varchar(255)", label: "varchar(255)" },
  { value: "integer", label: "integer" },
  { value: "bigint", label: "bigint" },
  { value: "boolean", label: "boolean" },
  { value: "numeric", label: "numeric" },
  { value: "timestamptz", label: "timestamptz" },
  { value: "date", label: "date" },
  { value: "jsonb", label: "jsonb" },
  { value: "uuid", label: "uuid" },
];

const inputClass =
  "w-full rounded-lg border border-(--border) bg-(--surface-sunken) px-3 py-1.5 text-sm text-(--text) outline-none transition-colors placeholder:text-(--text-faint) focus:border-(--accent)";

export function EditColumnDialog({ connectionId, table, schema, column, onClose }: EditColumnDialogProps) {
  const queryClient = useQueryClient();
  const [dataType, setDataType] = useState("");
  const [nullable, setNullable] = useState(true);
  const [defaultValue, setDefaultValue] = useState("");
  const [preview, setPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!column) {
      setDataType("");
      setNullable(true);
      setDefaultValue("");
      setPreview(null);
      setError(null);
      return;
    }
    setDataType(column.dataType);
    setNullable(column.nullable);
    setDefaultValue(column.defaultValue ?? "");
    setPreview(null);
    setError(null);
  }, [column]);

  if (!column) return null;
  const columnName = column.name;

  async function handlePreview() {
    setBusy(true);
    setError(null);
    // Empty default → drop the default; otherwise set it.
    const result = await commands.previewEditColumn(
      connectionId,
      schema,
      table,
      columnName,
      dataType,
      nullable,
      defaultValue.trim() || null,
    );
    setBusy(false);
    if (result.status === "error") {
      setError(friendlyError(result.error.message));
      return;
    }
    setPreview(result.data);
  }

  async function handleApply() {
    if (!preview) return;
    setBusy(true);
    setError(null);
    const result = await commands.executeDdl(connectionId, preview);
    setBusy(false);
    if (result.status === "error") {
      setError(friendlyError(result.error.message));
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["columns", connectionId, schema, table] });
    queryClient.invalidateQueries({ queryKey: ["rows", connectionId, schema, table] });
    onClose();
  }

  return (
    <Dialog.Root open={column !== null} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-(--bg)/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-(--border) bg-(--surface-raised) p-5 shadow-xl shadow-black/40 focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-(--text)">
            Edit Column: {columnName}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-(--text-faint)">
            {table} · changes are previewed as SQL before anything runs.
          </Dialog.Description>

          {preview === null ? (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-(--text-faint)">Type</span>
                <Select value={dataType} onChange={setDataType} options={COMMON_TYPES} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-(--text-faint)">
                  Default (raw SQL; leave empty to remove)
                </span>
                <input
                  value={defaultValue}
                  onChange={(e) => setDefaultValue(e.target.value)}
                  placeholder="e.g. 'active' or now()"
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={nullable}
                  onChange={(e) => setNullable(e.target.checked)}
                  className="accent-indigo-500"
                />
                <span className="text-xs text-(--text-muted)">Nullable</span>
              </label>
            </div>
          ) : (
            <div className="mt-4 space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-(--text-faint)">SQL to run</p>
              {preview.map((sql, i) => (
                <pre
                  key={i}
                  className="overflow-x-auto rounded-md bg-(--surface-sunken) px-2 py-1.5 font-mono text-xs text-(--text-muted)"
                >
                  {sql}
                </pre>
              ))}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg border border-(--danger)/50 bg-(--danger)/10 px-3 py-2 text-xs text-(--danger)">
              {error}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between">
            <button
              onClick={() => (preview === null ? onClose() : setPreview(null))}
              className="rounded-md px-3 py-1.5 text-sm text-(--text-muted) transition-colors hover:text-(--text)"
            >
              {preview === null ? "Cancel" : "Back"}
            </button>
            <button
              onClick={preview === null ? handlePreview : handleApply}
              disabled={busy}
              className="rounded-md bg-(--accent) px-4 py-1.5 text-sm font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Working…" : preview === null ? "Preview SQL" : "Apply"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
