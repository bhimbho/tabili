import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { friendlyError } from "../../lib/errors";

interface IndexDialogProps {
  connectionId: string;
  table: string;
  schema: string | null;
  /** Non-null opens the dialog for the create-index action. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Columns available on the table, used to pick indexed columns. */
  columns: string[];
}

const inputClass =
  "w-full rounded-lg border border-(--border) bg-(--surface-sunken) px-3 py-1.5 text-sm text-(--text) outline-none transition-colors placeholder:text-(--text-faint) focus:border-(--accent)";

export function IndexDialog({ connectionId, table, schema, open, onOpenChange, columns }: IndexDialogProps) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [unique, setUnique] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setName("");
      setUnique(false);
      setSelected([]);
      setPreview(null);
      setError(null);
    }
  }, [open]);

  function toggleColumn(c: string) {
    setSelected((prev) =>
      prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c],
    );
  }

  async function handlePreview() {
    setBusy(true);
    setError(null);
    const result = await commands.previewCreateIndex(
      connectionId,
      schema,
      table,
      name,
      unique,
      selected,
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
    queryClient.invalidateQueries({ queryKey: ["indexes", connectionId, schema, table] });
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-(--bg)/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-(--border) bg-(--surface-raised) p-5 shadow-xl shadow-black/40 focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-(--text)">Create Index</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-(--text-faint)">
            {table} · changes are previewed as SQL before anything runs.
          </Dialog.Description>

          {preview === null ? (
            <div className="mt-4 space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-(--text-faint)">Index name</span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="idx_table_column"
                  className={inputClass}
                />
              </label>
              <label className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  checked={unique}
                  onChange={(e) => setUnique(e.target.checked)}
                  className="accent-indigo-500"
                />
                <span className="text-xs text-(--text-muted)">Unique index</span>
              </label>
              <div>
                <span className="mb-1 block text-xs font-medium text-(--text-faint)">Columns</span>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-(--border) bg-(--surface-sunken) p-2">
                  {columns.map((c) => (
                    <label key={c} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.includes(c)}
                        onChange={() => toggleColumn(c)}
                        className="accent-indigo-500"
                      />
                      <span className="font-mono text-xs text-(--text-muted)">{c}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="mt-4 space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-(--text-faint)">SQL to run</p>
              {preview.map((sql, i) => (
                <pre key={i} className="overflow-x-auto rounded-md bg-(--surface-sunken) px-2 py-1.5 font-mono text-xs text-(--text-muted)">
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
              onClick={() => (preview === null ? onOpenChange(false) : setPreview(null))}
              className="rounded-md px-3 py-1.5 text-sm text-(--text-muted) transition-colors hover:text-(--text)"
            >
              {preview === null ? "Cancel" : "Back"}
            </button>
            <button
              onClick={preview === null ? handlePreview : handleApply}
              disabled={busy || (preview === null && (!name.trim() || selected.length === 0))}
              className="rounded-md bg-(--accent) px-4 py-1.5 text-sm font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Working…" : preview === null ? "Preview SQL" : "Create Index"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
