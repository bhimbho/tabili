import type { QueryClient } from "@tanstack/react-query";
import { commands } from "../bindings";
import { useChangesStore, type PendingDelete } from "../stores/changesStore";
import { useConsoleStore } from "../stores/consoleStore";
import { friendlyError } from "./errors";
import { groupEdits } from "./pendingSql";

/**
 * Applies every staged change. Shared by the review dialog and ⌘S so both take
 * exactly the same path — ⌘S is simply the version without the confirmation step.
 * Successful items are dropped from the store as they land, so a partial failure
 * leaves only the statements that still need attention.
 */
export async function commitChanges(queryClient: QueryClient): Promise<string[]> {
  const { edits, inserts, deletes } = useChangesStore.getState();
  const log = useConsoleStore.getState().log;
  const errors: string[] = [];
  const touched = new Set<string>();

  for (const g of groupEdits(Array.from(edits.values()))) {
    const result = await commands.updateRow(g.connectionId, g.schema, g.table, g.pk, g.changes);
    touched.add(g.connectionId);
    if (result.status === "error") {
      const message = friendlyError(result.error.message);
      errors.push(message);
      log({ sql: `UPDATE ${g.table}`, success: false, error: result.error.message });
    } else {
      log({ sql: result.data, success: true });
      useChangesStore.setState((s) => {
        const next = new Map(s.edits);
        for (const [key, e] of next) {
          if (e.connectionId === g.connectionId && e.table === g.table && e.pkKey === g.pkKey) {
            next.delete(key);
          }
        }
        return { edits: next };
      });
    }
  }

  for (const i of Array.from(inserts.values())) {
    const result = await commands.insertRow(i.connectionId, i.schema, i.table, i.values);
    touched.add(i.connectionId);
    if (result.status === "error") {
      errors.push(friendlyError(result.error.message));
      log({ sql: `INSERT INTO ${i.table}`, success: false, error: result.error.message });
    } else {
      log({ sql: result.data, success: true });
      useChangesStore.getState().removeInsert(i.tempId);
    }
  }

  const byTable = new Map<string, PendingDelete[]>();
  for (const d of Array.from(deletes.values())) {
    const key = `${d.connectionId}:${d.schema ?? ""}:${d.table}`;
    byTable.set(key, [...(byTable.get(key) ?? []), d]);
  }
  for (const group of byTable.values()) {
    const { connectionId, table, schema } = group[0];
    const result = await commands.deleteRows(connectionId, schema, table, group.map((d) => d.pk));
    touched.add(connectionId);
    if (result.status === "error") {
      errors.push(friendlyError(result.error.message));
      log({ sql: `DELETE FROM ${table}`, success: false, error: result.error.message });
    } else {
      result.data.forEach((sql) => log({ sql, success: true }));
      useChangesStore.setState((s) => {
        const next = new Map(s.deletes);
        for (const d of group) next.delete(`${d.connectionId}:${d.table}:${d.pkKey}`);
        return { deletes: next };
      });
    }
  }

  for (const connectionId of touched) {
    queryClient.invalidateQueries({ queryKey: ["rows", connectionId] });
  }
  queryClient.invalidateQueries({ queryKey: ["statement-log"] });

  return errors;
}
