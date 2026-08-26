import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { friendlyError } from "../../lib/errors";

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
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 w-[540px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl shadow-black/40 focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-neutral-100">Create Trigger</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-neutral-500">
            {table} · write the full CREATE TRIGGER statement for your dialect.
          </Dialog.Description>

          {preview === null ? (
            <div className="mt-4">
              <textarea
                value={sql}
                onChange={(e) => setSql(e.target.value)}
                spellCheck={false}
                className="h-56 w-full resize-none rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 font-mono text-xs leading-relaxed text-neutral-100 outline-none focus:border-indigo-500"
              />
            </div>
          ) : (
            <div className="mt-4 space-y-1">
              <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">SQL to run</p>
              {preview.map((stmt, i) => (
                <pre key={i} className="overflow-x-auto rounded-md bg-black/30 px-2 py-1.5 font-mono text-xs text-neutral-300">
                  {stmt}
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
              onClick={() => (preview === null ? onOpenChange(false) : setPreview(null))}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-200"
            >
              {preview === null ? "Cancel" : "Back"}
            </button>
            <button
              onClick={preview === null ? handlePreview : handleApply}
              disabled={busy || (preview === null && !sql.trim())}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Working…" : preview === null ? "Preview SQL" : "Create Trigger"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
