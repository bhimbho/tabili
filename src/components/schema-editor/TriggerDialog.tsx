import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { friendlyError } from "../../lib/errors";
import { DialogCloseButton } from "../ui/DialogCloseButton";

interface TriggerDialogProps {
  connectionId: string;
  table: string;
  schema: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function TriggerDialog({ connectionId, table, schema, open, onOpenChange }: TriggerDialogProps) {
  const queryClient = useQueryClient();
  const [sql, setSql] = useState("");
  const [preview, setPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSql(`CREATE TRIGGER ${table}_trigger\nAFTER INSERT ON ${table}\nFOR EACH ROW\nBEGIN\n  -- write your trigger body here\nEND;`);
      setPreview(null);
      setError(null);
    }
  }, [open, table]);

  function handlePreview() {
    setError(null);
    setPreview([sql]);
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
    queryClient.invalidateQueries({ queryKey: ["triggers", connectionId, schema, table] });
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-(--bg)/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 w-[540px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-(--border) bg-(--surface-raised) p-5 shadow-xl shadow-black/40 focus:outline-none">
          <DialogCloseButton onClose={() => onOpenChange(false)} />
          <Dialog.Title className="text-base font-semibold text-(--text)">Create Trigger</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-(--text-faint)">
            {table} · write the full CREATE TRIGGER statement for your dialect.
          </Dialog.Description>

          {preview === null ? (
            <div className="mt-4">
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                spellCheck={false}
                className="h-56 w-full resize-none rounded-lg border border-(--border) bg-(--surface-sunken) px-3 py-2 font-mono text-xs leading-relaxed text-(--text) outline-none focus:border-(--accent)"
              />
            </div>
          ) : (
            <div className="mt-4 space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-(--text-faint)">SQL to run</p>
              {preview.map((stmt, i) => (
                <pre key={i} className="overflow-x-auto rounded-md bg-(--surface-sunken) px-2 py-1.5 font-mono text-xs text-(--text-muted)">
                  {stmt}
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
              disabled={busy || (preview === null && !sql.trim())}
              className="rounded-md bg-(--accent) px-4 py-1.5 text-sm font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Working…" : preview === null ? "Preview SQL" : "Create Trigger"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
