import { useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import type { DbValue } from "../../bindings";
import { useChangesStore, pkKeyOf, type PendingDelete, type PendingEdit, type PendingInsert } from "../../stores/changesStore";

interface PendingChangesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function sqlLiteral(value: DbValue): string {
  switch (value.type) {
    case "Null":
      return "NULL";
    case "Bool":
      return value.value ? "true" : "false";
    case "Int":
    case "Float":
      return String(value.value);
    case "Decimal":
      return value.value;
    default:
      return `'${displayText(value).replace(/'/g, "''")}'`;
  }
}

function displayText(value: DbValue): string {
  switch (value.type) {
    case "Null":
      return "";
    case "Bool":
      return String(value.value);
    case "Int":
    case "Float":
      return String(value.value);
    case "Decimal":
    case "Text":
    case "DateTime":
    case "Uuid":
      return value.value;
    default:
      return JSON.stringify(value);
  }
}

interface EditGroup {
  connectionId: string;
  table: string;
  schema: string | null;
  pkKey: string;
  pk: Record<string, DbValue>;
  changes: Record<string, DbValue>;
}

function groupEdits(edits: PendingEdit[]): EditGroup[] {
  const groups = new Map<string, EditGroup>();
  for (const edit of edits) {
    const groupKey = `${edit.connectionId}:${edit.table}:${edit.pkKey}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.changes[edit.column] = edit.newValue;
    } else {
      groups.set(groupKey, {
        connectionId: edit.connectionId,
        table: edit.table,
        schema: edit.schema,
        pkKey: edit.pkKey,
        pk: edit.pk,
        changes: { [edit.column]: edit.newValue },
      });
    }
  }
  return Array.from(groups.values());
}

function editSql(g: EditGroup): string {
  const set = Object.entries(g.changes).map(([c, v]) => `${c} = ${sqlLiteral(v)}`).join(", ");
  const where = Object.entries(g.pk).map(([c, v]) => `${c} = ${sqlLiteral(v)}`).join(" AND ");
  return `UPDATE ${g.table} SET ${set} WHERE ${where};`;
}

function insertSql(i: PendingInsert): string {
  const cols = Object.keys(i.values);
  const vals = cols.map((c) => sqlLiteral(i.values[c]));
  return `INSERT INTO ${i.table} (${cols.join(", ")}) VALUES (${vals.join(", ")});`;
}

function deleteSql(d: PendingDelete): string {
  const where = Object.entries(d.pk).map(([c, v]) => `${c} = ${sqlLiteral(v)}`).join(" AND ");
  return `DELETE FROM ${d.table} WHERE ${where};`;
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
    const newErrors: string[] = [];
    const touched = new Set<string>();

    for (const g of editGroups) {
      const result = await commands.updateRow(g.connectionId, g.schema, g.table, g.pk, g.changes);
      touched.add(`${g.connectionId}:${g.table}`);
      if (result.status === "error") {
        newErrors.push(`UPDATE ${g.table} (${pkKeyOf(g.pk)}): ${result.error.message}`);
      } else {
        useChangesStore.setState((s) => {
          const next = new Map(s.edits);
          for (const [key, e] of next) {
            if (e.connectionId === g.connectionId && e.table === g.table && e.pkKey === g.pkKey) next.delete(key);
          }
          return { edits: next };
        });
      }
    }

    for (const i of insertList) {
      const result = await commands.insertRow(i.connectionId, i.schema, i.table, i.values);
      touched.add(`${i.connectionId}:${i.table}`);
      if (result.status === "error") {
        newErrors.push(`INSERT INTO ${i.table}: ${result.error.message}`);
      } else {
        useChangesStore.getState().removeInsert(i.tempId);
      }
    }

    const deletesByTable = new Map<string, PendingDelete[]>();
    for (const d of deleteList) {
      const key = `${d.connectionId}:${d.table}`;
      deletesByTable.set(key, [...(deletesByTable.get(key) ?? []), d]);
    }
    for (const [key, group] of deletesByTable) {
      const { connectionId, table, schema } = group[0];
      const result = await commands.deleteRows(connectionId, schema, table, group.map((d) => d.pk));
      touched.add(key);
      if (result.status === "error") {
        newErrors.push(`DELETE FROM ${table}: ${result.error.message}`);
      } else {
        useChangesStore.setState((s) => {
          const next = new Map(s.deletes);
          for (const d of group) next.delete(`${d.connectionId}:${d.table}:${d.pkKey}`);
          return { deletes: next };
        });
      }
    }

    for (const key of touched) {
      const [connectionId] = key.split(":");
      // Row keys are ["rows", connectionId, schema, table, query]; match on the
      // connection prefix so every affected schema/query variant refetches.
      queryClient.invalidateQueries({ queryKey: ["rows", connectionId] });
    }

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
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 flex max-h-[70vh] w-[600px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl shadow-black/40 focus:outline-none">
          <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
            <Dialog.Title className="text-sm font-semibold text-neutral-100">
              Pending Changes {total > 0 ? `(${total})` : ""}
            </Dialog.Title>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-3">
            {total === 0 && <p className="text-sm text-neutral-500">No pending changes.</p>}

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
              <div className="mt-3 space-y-1 rounded-lg border border-red-900/50 bg-red-950/50 px-3 py-2">
                {errors.map((e, i) => (
                  <p key={i} className="text-xs text-red-300">{e}</p>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between border-t border-neutral-800 px-4 py-3">
            <button
              onClick={handleDiscard}
              disabled={total === 0 || committing}
              className="rounded-md px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-200 disabled:opacity-40"
            >
              Discard
            </button>
            <button
              onClick={handleCommit}
              disabled={total === 0 || committing}
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {committing ? "Committing…" : "Commit"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-neutral-500">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function CodeLine({ children }: { children: React.ReactNode }) {
  return (
    <pre className="overflow-x-auto rounded-md bg-black/30 px-2 py-1.5 font-mono text-xs text-neutral-300">
      {children}
    </pre>
  );
}
