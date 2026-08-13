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
  | "export-all"
  | "export-table"
  | "import-csv"
  | "import-sql"
  | "preview-changes"
  | null;

interface DialogsState {
  dialog: AppDialog;
  open: (dialog: Exclude<AppDialog, null>) => void;
  close: () => void;
}

export const useDialogsStore = create<DialogsState>((set) => ({
  dialog: null,
  open: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));
