import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { DialogCloseButton } from "../ui/DialogCloseButton";

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
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-(--bg)/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-(--border) bg-(--surface-raised) p-5 shadow-xl shadow-black/40 focus:outline-none">
          <DialogCloseButton onClose={onClose} />
          <Dialog.Title className="text-base font-semibold text-(--text)">Drop Column</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-(--text-faint)">
            This permanently deletes <span className="font-medium text-(--text)">{column}</span> and all its
            data from {table}.
          </Dialog.Description>

          {preview && (
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
              onClick={onClose}
              className="rounded-md px-3 py-1.5 text-sm text-(--text-muted) transition-colors hover:text-(--text)"
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={busy || !preview}
              className="rounded-md bg-(--danger) px-4 py-1.5 text-sm font-medium text-(--accent-text) transition-colors hover:bg-(--danger)/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Dropping…" : "Drop Column"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
