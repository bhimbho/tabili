import { create } from "zustand";
import type { ColumnInfo, DbValue } from "../bindings";

export type FkMap = Record<string, { table: string; column: string }>;

interface DetailsContext {
  connectionId: string;
  schema: string | null;
  table: string;
  columns: string[];
  columnInfos: ColumnInfo[];
  foreignKeys: FkMap;
}

interface DetailsState {
  /** Null when the active tab has nothing row-shaped to inspect. */
  context: DetailsContext | null;
  row: Record<string, DbValue> | null;
  setContext: (context: DetailsContext | null) => void;
  setRow: (row: Record<string, DbValue> | null) => void;
}

/**
 * The Details pane lives at the window edge rather than inside the table view, so
 * the selected row has to be published somewhere both can reach.
 */
export const useDetailsStore = create<DetailsState>((set) => ({
  context: null,
  row: null,
  setContext: (context) =>
    set((state) => ({
      context,
      // Switching table invalidates whichever row was selected in the old one.
      row: context && state.context?.table === context.table ? state.row : null,
    })),
  setRow: (row) => set({ row }),
}));
