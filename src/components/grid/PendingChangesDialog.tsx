import { useMemo, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useChangesStore } from "../../stores/changesStore";
import { commitChanges } from "../../lib/commitChanges";
import { deleteSql, editSql, groupEdits, insertSql } from "../../lib/pendingSql";
import { DialogCloseButton } from "../ui/DialogCloseButton";

interface PendingChangesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PendingChangesDialog({ open, onOpenChange }: PendingChangesDialogProps) {
  const edits = useChangesStore((s) => s.edits);
  const inserts = useChangesStore((s) => s.inserts);
  const deletes = useChangesStore((s) => s.deletes);
  const discardAll = useChangesStore((s) => s.discardAll);
  const queryClient = useQueryClient();

  const [committing, setCommitting] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  const editGroups = useMemo(() => groupEdits(Array.from(edits.values())), [edits]);
  const insertList = useMemo(() => Array.from(inserts.values()), [inserts]);
  const deleteList = useMemo(() => Array.from(deletes.values()), [deletes]);

  const total = editGroups.length + insertList.length + deleteList.length;

  async function handleCommit() {
    setCommitting(true);
    const newErrors = await commitChanges(queryClient);
    setErrors(newErrors);
    setCommitting(false);
    if (newErrors.length === 0) onOpenChange(false);
  }

  function handleDiscard() {
    discardAll();
    setErrors([]);
    onOpenChange(false);
  }

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-(--bg)/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 flex max-h-[70vh] w-[600px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-(--border) bg-(--surface-raised) shadow-xl shadow-black/40 focus:outline-none">
          <DialogCloseButton onClose={() => onOpenChange(false)} />
          <div className="flex items-center justify-between border-b border-(--border) px-4 py-3">
            <Dialog.Title className="text-sm font-semibold text-(--text)">
              Pending Changes {total > 0 ? `(${total})` : ""}
            </Dialog.Title>
            <span className="text-xs text-(--text-faint)">⌘S commits without this dialog</span>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {total === 0 && <p className="text-sm text-(--text-muted)">No pending changes.</p>}

            {editGroups.length > 0 && (
              <Section title="Updates">
                {editGroups.map((g) => (
                  <CodeLine key={`${g.connectionId}:${g.table}:${g.pkKey}`}>{editSql(g)}</CodeLine>
                ))}
              </Section>
            )}
            {insertList.length > 0 && (
              <Section title="Inserts">
                {insertList.map((i) => (
                  <CodeLine key={i.tempId}>{insertSql(i)}</CodeLine>
                ))}
              </Section>
            )}
            {deleteList.length > 0 && (
              <Section title="Deletes">
                {deleteList.map((d) => (
                  <CodeLine key={`${d.connectionId}:${d.table}:${d.pkKey}`}>{deleteSql(d)}</CodeLine>
                ))}
              </Section>
            )}

            {errors.length > 0 && (
              <div className="mt-3 space-y-1 rounded-lg border border-(--danger)/50 bg-(--danger)/10 px-3 py-2">
                {errors.map((e, i) => (
                  <p key={i} className="text-xs text-(--danger)">
                    {e}
                  </p>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-(--border) px-4 py-3">
            <button
              onClick={handleDiscard}
              disabled={total === 0 || committing}
              className="rounded-md px-3 py-1.5 text-sm text-(--text-muted) transition-colors hover:text-(--text) disabled:opacity-40"
            >
              Discard
            </button>
            <button
              onClick={handleCommit}
              disabled={total === 0 || committing}
              className="rounded-md bg-(--accent) px-4 py-1.5 text-sm font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {committing ? "Committing…" : "Commit"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-(--text-faint)">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function CodeLine({ children }: { children: ReactNode }) {
  return (
    <pre className="selectable overflow-x-auto rounded-md bg-(--surface-sunken) px-2 py-1.5 font-mono text-xs text-(--text-muted)">
      {children}
    </pre>
  );
}
