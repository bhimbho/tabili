import { create } from "zustand";

export interface ConsoleEntry {
  id: string;
  sql: string;
  success: boolean;
  error?: string;
  durationMs?: number;
  at: number;
}

interface ConsoleState {
  entries: ConsoleEntry[];
  open: boolean;
  /** Bumped when a statement fails so the console can auto-open on errors. */
  toggle: () => void;
  setOpen: (open: boolean) => void;
  log: (entry: Omit<ConsoleEntry, "id" | "at">) => void;
  clear: () => void;
}

const MAX_ENTRIES = 300;

export const useConsoleStore = create<ConsoleState>((set) => ({
  entries: [],
  open: false,
  toggle: () => set((s) => ({ open: !s.open })),
  setOpen: (open) => set({ open }),
  log: (entry) =>
    set((s) => ({
      entries: [{ ...entry, id: crypto.randomUUID(), at: Date.now() }, ...s.entries].slice(
        0,
        MAX_ENTRIES,
      ),
      // A failure the user didn't ask to see is exactly when the console is useful.
      open: entry.success ? s.open : true,
    })),
  clear: () => set({ entries: [] }),
}));
