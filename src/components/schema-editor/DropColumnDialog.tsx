import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";

interface DropColumnDialogProps {
  connectionId: string;
  table: string;
  schema: string | null;
  /** Non-null opens the dialog for that column. */
  column: string | null;
  onClose: () => void;
}

export function DropColumnDialog({ connectionId, table, schema, column, onClose }: DropColumnDialogProps) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Dropping a column is irreversible, so the SQL is fetched up front — the user
  // never sees a bare "are you sure?" without the exact statement behind it.
  useEffect(() => {
    if (!column) {
      setPreview(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = await commands.previewDropColumn(connectionId, schema, table, column);
      if (cancelled) return;
      if (result.status === "error") setError(result.error.message);
      else setPreview(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, schema, table, column]);

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
    onClose();
  }

  return (
    <Dialog.Root open={column !== null} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl shadow-black/40 focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-neutral-100">Drop Column</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-neutral-500">
            This permanently deletes <span className="font-medium text-neutral-300">{column}</span> and all its
            data from {table}.
          </Dialog.Description>

          {preview && (
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
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-200"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={busy || !preview}
              className="rounded-md bg-red-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Dropping…" : "Drop Column"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
