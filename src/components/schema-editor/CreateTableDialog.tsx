import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { Select } from "../ui/Select";

interface CreateTableDialogProps {
  connectionId: string;
  schema: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

interface ColumnDraft {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string;
  isPrimaryKey: boolean;
}

const inputClass =
  "w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-indigo-500";

export function CreateTableDialog({ connectionId, schema, open, onOpenChange }: CreateTableDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<ColumnDraft[]>([
    { name: "id", dataType: "integer", nullable: false, defaultValue: "", isPrimaryKey: true },
    { name: "", dataType: "text", nullable: true, defaultValue: "", isPrimaryKey: false },
  ]);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setColumns([
      { name: "id", dataType: "integer", nullable: false, defaultValue: "", isPrimaryKey: true },
      { name: "", dataType: "text", nullable: true, defaultValue: "", isPrimaryKey: false },
    ]);
    setPreview(null);
    setBusy(false);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function updateColumn(idx: number, patch: Partial<ColumnDraft>) {
    setColumns((prev) => prev.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
  }

  function addColumn() {
    setColumns((prev) => [
      ...prev,
      { name: "", dataType: "text", nullable: true, defaultValue: "", isPrimaryKey: false },
    ]);
  }

  function removeColumn(idx: number) {
    setColumns((prev) => prev.filter((_, i) => i !== idx));
  }

  async function handlePreview() {
    setBusy(true);
    setError(null);
    const valid = columns.filter((c) => c.name.trim());
    const result = await commands.previewCreateTable(connectionId, {
      name,
      columns: valid.map((c) => ({
        name: c.name.trim(),
        dataType: c.dataType,
        nullable: c.nullable,
        defaultValue: c.defaultValue.trim() || null,
      })),
      primaryKey: valid.filter((c) => c.isPrimaryKey).map((c) => c.name.trim()),
    });
    setBusy(false);
    if (result.status === "error") {
      setError(result.error.message);
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
      setError(result.error.message);
      return;
    }
    queryClient.invalidateQueries({ queryKey: ["tables", connectionId] });
    queryClient.invalidateQueries({ queryKey: ["views", connectionId] });
    handleOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 w-[560px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl shadow-black/40 focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-neutral-100">New Table</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-neutral-500">
            {schema ?? "default schema"} · changes are previewed as SQL before anything runs.
          </Dialog.Description>

          {preview === null ? (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-500">Table name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="table_name"
                  className={inputClass}
                />
              </label>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-medium text-neutral-500">Columns</span>
                  <button
                    onClick={addColumn}
                    className="rounded-md bg-neutral-800 px-2 py-0.5 text-xs font-medium text-neutral-200 transition-colors hover:bg-neutral-700"
                  >
                    + Add column
                  </button>
                </div>

                <div className="max-h-[260px] space-y-2 overflow-y-auto">
                  {columns.map((col, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={col.isPrimaryKey}
                        onChange={(e) => updateColumn(idx, { isPrimaryKey: e.target.checked })}
                        title="Primary key"
                        className="accent-indigo-500"
                      />
                      <input
                        value={col.name}
                        onChange={(e) => updateColumn(idx, { name: e.target.value })}
                        placeholder="column"
                        className="w-32 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-indigo-500"
                      />
                      <div className="w-32">
                        <Select
                          size="sm"
                          value={col.dataType}
                          onChange={(v) => updateColumn(idx, { dataType: v })}
                          options={COMMON_TYPES}
                        />
                      </div>
                      <input
                        value={col.defaultValue}
                        onChange={(e) => updateColumn(idx, { defaultValue: e.target.value })}
                        placeholder="default"
                        className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-indigo-500"
                      />
                      <label className="flex shrink-0 items-center gap-1 text-xs text-neutral-400">
                        <input
                          type="checkbox"
                          checked={col.nullable}
                          onChange={(e) => updateColumn(idx, { nullable: e.target.checked })}
                          className="accent-indigo-500"
                        />
                        null
                      </label>
                      <button
                        onClick={() => removeColumn(idx)}
                        disabled={columns.length <= 1}
                        className="shrink-0 rounded px-1.5 text-neutral-500 transition-colors hover:bg-red-900/30 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-30"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">SQL to run</p>
              {preview.map((sql, i) => (
                <pre
                  key={i}
                  className="overflow-x-auto rounded-md bg-black/30 px-2 py-1.5 font-mono text-xs text-neutral-300"
                >
                  {sql}
                </pre>
              ))}
            </div>
          )}

          {error && (
            <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="mt-5 flex items-center justify-between">
            <button
              onClick={() => (preview === null ? handleOpenChange(false) : setPreview(null))}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-200"
            >
              {preview === null ? "Cancel" : "Back"}
            </button>
            <button
              onClick={preview === null ? handlePreview : handleApply}
              disabled={busy || (preview === null && (!name.trim() || !columns.some((c) => c.name.trim())))}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Working…" : preview === null ? "Preview SQL" : "Create Table"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
