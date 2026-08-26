import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { friendlyError } from "../../lib/errors";
import { useTabsStore } from "../../stores/tabsStore";
import { DialogCloseButton } from "../ui/DialogCloseButton";

interface TableActionsDialogProps {
  connectionId: string;
  schema: string | null;
  /** Non-null opens the dialog for that table. */
  table: string | null;
  action: "truncate" | "drop" | null;
  onClose: () => void;
}

export function TableActionsDialog({
  connectionId,
  schema,
  table,
  action,
  onClose,
}: TableActionsDialogProps) {
  const queryClient = useQueryClient();
  const closeTab = useTabsStore((s) => s.closeTab);
  const [preview, setPreview] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isDrop = action === "drop";
  const open = table !== null && action !== null;

  useEffect(() => {
    if (!open) {
      setPreview(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const result = isDrop
        ? await commands.previewDropTable(connectionId, schema, table)
        : await commands.previewTruncateTable(connectionId, schema, table);
      if (cancelled) return;
      if (result.status === "error") setError(friendlyError(result.error.message));
      else setPreview(result.data);
    })();
    return () => {
      cancelled = true;
    };
  }, [connectionId, schema, table, isDrop, open]);

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
    // Dropping a table closes any tab for it.
    if (isDrop && connectionId && table) {
      const schemaPrefix = schema ? `${schema}:` : "";
      closeTab(`${connectionId}:${schemaPrefix}${table}`);
    }
    await queryClient.invalidateQueries({ queryKey: ["tables", connectionId] });
    await queryClient.invalidateQueries({ queryKey: ["views", connectionId] });
    await queryClient.invalidateQueries({ queryKey: ["rows", connectionId] });
    onClose();
  }

  const title = isDrop ? "Drop Table" : "Truncate Table";
  const confirmLabel = isDrop ? (busy ? "Dropping…" : "Drop Table") : busy ? "Truncating…" : "Truncate";
  const description = isDrop
    ? `This permanently deletes ${table} and ALL of its data, structure, and indexes. This cannot be undone.`
    : `This deletes ALL rows in ${table}. The table structure and indexes remain. This cannot be undone.`;

  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-(--bg)/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 w-[460px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-(--border) bg-(--surface-raised) p-5 shadow-xl shadow-black/40 focus:outline-none">
          <DialogCloseButton onClose={onClose} />
          <Dialog.Title className="text-base font-semibold text-(--text)">{title}</Dialog.Title>
          <Dialog.Description className="mt-1 text-xs text-(--text-faint)">
            {description}
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
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
