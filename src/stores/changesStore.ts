import { create } from "zustand";
import type { DbValue } from "../bindings";

export interface RowContext {
  connectionId: string;
  table: string;
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

interface ChangesState {
  edits: Map<string, PendingEdit>;
  inserts: Map<string, PendingInsert>;
  deletes: Map<string, PendingDelete>;

  setEdit: (edit: Omit<PendingEdit, "pkKey">) => void;
  setInsertValue: (tempId: string, ctx: RowContext, column: string, value: DbValue) => void;
  addInsert: (ctx: RowContext, tempId: string) => void;
  removeInsert: (tempId: string) => void;
  toggleDelete: (ctx: RowContext, pk: Record<string, DbValue>) => void;
  isDeleted: (pk: Record<string, DbValue>) => boolean;
  discardAll: () => void;
  count: () => number;
}

export const useChangesStore = create<ChangesState>((set, get) => ({
  edits: new Map(),
  inserts: new Map(),
  deletes: new Map(),

  setEdit: (edit) =>
    set((state) => {
      const pkKey = pkKeyOf(edit.pk);
      const key = `${edit.connectionId}:${edit.table}:${pkKey}:${edit.column}`;
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
      const key = `${ctx.connectionId}:${ctx.table}:${pkKey}`;
      const deletes = new Map(state.deletes);
      if (deletes.has(key)) {
        deletes.delete(key);
      } else {
        deletes.set(key, { ...ctx, pkKey, pk });
      }
      return { deletes };
    }),

  isDeleted: (pk) => {
    const pkKey = pkKeyOf(pk);
    for (const d of get().deletes.values()) {
      if (d.pkKey === pkKey) return true;
    }
    return false;
  },

  discardAll: () => set({ edits: new Map(), inserts: new Map(), deletes: new Map() }),

  count: () => get().edits.size + get().inserts.size + get().deletes.size,
}));
