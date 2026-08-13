import { create } from "zustand";

/**
 * App-level dialogs that more than one place can open — notably the native menu,
 * which can't reach component-local state.
 *
 * `export-all` lists every table on the connection; `export-table` targets the
 * active tab's table and adds column selection.
 */
export type AppDialog =
  | "new-connection"
  | "edit-connection"
  | "export-all"
  | "export-table"
  | "import-csv"
  | "import-sql"
  | "preview-changes"
  | null;

interface DialogsState {
  dialog: AppDialog;
  /** Which saved connection "edit-connection" is editing. */
  editingConnectionId: string | null;
  open: (dialog: Exclude<AppDialog, null>) => void;
  openEdit: (connectionId: string) => void;
  close: () => void;
}

export const useDialogsStore = create<DialogsState>((set) => ({
  dialog: null,
  editingConnectionId: null,
  open: (dialog) => set({ dialog, editingConnectionId: null }),
  openEdit: (connectionId) =>
    set({ dialog: "edit-connection", editingConnectionId: connectionId }),
  close: () => set({ dialog: null, editingConnectionId: null }),
}));
