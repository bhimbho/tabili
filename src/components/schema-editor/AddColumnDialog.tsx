import { useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { Select } from "../ui/Select";

interface AddColumnDialogProps {
  connectionId: string;
  table: string;
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

const inputClass =
  "w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-indigo-500";

export function AddColumnDialog({ connectionId, table, schema, open, onOpenChange }: AddColumnDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [dataType, setDataType] = useState("text");
  const [nullable, setNullable] = useState(true);
  const [defaultValue, setDefaultValue] = useState("");
  const [preview, setPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setDataType("text");
    setNullable(true);
    setDefaultValue("");
    setPreview(null);
    setBusy(false);
    setError(null);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handlePreview() {
    setBusy(true);
    setError(null);
    const result = await commands.previewAddColumn(connectionId, schema, table, {
      name,
      dataType,
      nullable,
      defaultValue: defaultValue || null,
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
    queryClient.invalidateQueries({ queryKey: ["columns", connectionId, schema, table] });
    queryClient.invalidateQueries({ queryKey: ["rows", connectionId, schema, table] });
    handleOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl shadow-black/40 focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-neutral-100">Add Column</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-neutral-500">
            {table} · changes are previewed as SQL before anything runs.
          </Dialog.Description>

          {preview === null ? (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-500">Name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="column_name"
                  className={inputClass}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-500">Type</span>
                <Select value={dataType} onChange={setDataType} options={COMMON_TYPES} />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-neutral-500">
                  Default (raw SQL, optional)
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
                <span className="text-xs text-neutral-400">Nullable</span>
              </label>
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
              disabled={busy || (preview === null && !name.trim())}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Working…" : preview === null ? "Preview SQL" : "Apply"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
