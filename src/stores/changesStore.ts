import { create } from "zustand";
import type { DbValue } from "../bindings";

export interface RowContext {
  connectionId: string;
  table: string;
  schema: string | null;
}

export interface PendingEdit extends RowContext {
  pkKey: string;
  pk: Record<string, DbValue>;
  column: string;
  oldValue: DbValue;
  newValue: DbValue;
}

export interface PendingInsert extends RowContext {
  tempId: string;
  values: Record<string, DbValue>;
}

export interface PendingDelete extends RowContext {
  pkKey: string;
  pk: Record<string, DbValue>;
}

export function pkKeyOf(pk: Record<string, DbValue>): string {
  return JSON.stringify(Object.keys(pk).sort().map((k) => [k, pk[k]]));
}

/**
 * Identifies the row a staged change belongs to. The schema is part of it: two
 * schemas on one connection routinely hold a table of the same name, and keying
 * on the name alone made an edit in one appear in the other.
 */
export function rowKeyOf(ctx: RowContext, pkKey: string): string {
  return `${ctx.connectionId}:${ctx.schema ?? ""}:${ctx.table}:${pkKey}`;
}

/** True when a staged change belongs to the given connection/schema/table. */
export function belongsTo(change: RowContext, ctx: RowContext): boolean {
  return (
    change.connectionId === ctx.connectionId &&
    change.schema === ctx.schema &&
    change.table === ctx.table
  );
}

interface ChangesState {
  edits: Map<string, PendingEdit>;
  inserts: Map<string, PendingInsert>;
  deletes: Map<string, PendingDelete>;

  setEdit: (edit: Omit<PendingEdit, "pkKey">) => void;
  setInsertValue: (tempId: string, ctx: RowContext, column: string, value: DbValue) => void;
  addInsert: (ctx: RowContext, tempId: string) => void;
  removeInsert: (tempId: string) => void;
  toggleDelete: (ctx: RowContext, pk: Record<string, DbValue>) => void;
  /** Scoped to one table: a primary key alone repeats across tables and servers. */
  isDeleted: (ctx: RowContext, pk: Record<string, DbValue>) => boolean;
  /** Omitting the connection discards every connection's changes. */
  discardAll: (connectionId?: string) => void;
  /** Omitting the connection counts every connection's changes. */
  count: (connectionId?: string) => number;
}

export const useChangesStore = create<ChangesState>((set, get) => ({
  edits: new Map(),
  inserts: new Map(),
  deletes: new Map(),

  setEdit: (edit) =>
    set((state) => {
      const pkKey = pkKeyOf(edit.pk);
      const key = `${rowKeyOf(edit, pkKey)}:${edit.column}`;
      const edits = new Map(state.edits);
      if (JSON.stringify(edit.newValue) === JSON.stringify(edit.oldValue)) {
        edits.delete(key);
      } else {
        edits.set(key, { ...edit, pkKey });
      }
      return { edits };
    }),

  addInsert: (ctx, tempId) =>
    set((state) => {
      const inserts = new Map(state.inserts);
      inserts.set(tempId, { ...ctx, tempId, values: {} });
      return { inserts };
    }),

  setInsertValue: (tempId, ctx, column, value) =>
    set((state) => {
      const inserts = new Map(state.inserts);
      const existing = inserts.get(tempId) ?? { ...ctx, tempId, values: {} };
      inserts.set(tempId, { ...existing, values: { ...existing.values, [column]: value } });
      return { inserts };
    }),

  removeInsert: (tempId) =>
    set((state) => {
      const inserts = new Map(state.inserts);
      inserts.delete(tempId);
      return { inserts };
    }),

  toggleDelete: (ctx, pk) =>
    set((state) => {
      const pkKey = pkKeyOf(pk);
      const key = rowKeyOf(ctx, pkKey);
      const deletes = new Map(state.deletes);
      if (deletes.has(key)) {
        deletes.delete(key);
      } else {
        deletes.set(key, { ...ctx, pkKey, pk });
      }
      return { deletes };
    }),

  isDeleted: (ctx, pk) => get().deletes.has(rowKeyOf(ctx, pkKeyOf(pk))),

  discardAll: (connectionId) =>
    set((state) => {
      if (!connectionId) {
        return { edits: new Map(), inserts: new Map(), deletes: new Map() };
      }
      const keep = <T extends RowContext>(map: Map<string, T>) =>
        new Map(Array.from(map).filter(([, v]) => v.connectionId !== connectionId));
      return {
        edits: keep(state.edits),
        inserts: keep(state.inserts),
        deletes: keep(state.deletes),
      };
    }),

  count: (connectionId) => {
    const { edits, inserts, deletes } = get();
    if (!connectionId) return edits.size + inserts.size + deletes.size;
    const mine = (c: RowContext) => c.connectionId === connectionId;
    return (
      Array.from(edits.values()).filter(mine).length +
      Array.from(inserts.values()).filter(mine).length +
      Array.from(deletes.values()).filter(mine).length
    );
  },
}));
