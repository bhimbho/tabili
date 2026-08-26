import { create } from "zustand";
import type { DbValue } from "../bindings";

/**
 * Bridges native-menu actions to the active SQL editor. The editor registers
 * itself here on mount (via `register`), and menu actions call through to it.
 * This keeps the menu handler free of any direct DOM/Monaco coupling.
 */
interface SqlEditorStore {
  /** The active editor's Monaco instance, if one is mounted. */
  editor: Parameters<import("@monaco-editor/react").OnMount>[0] | null;
  /** The active editor's tab id, so Save As can read its text. */
  tabId: string | null;
  /** The active editor's current SQL text. */
  sql: string;
  /** Whether the find-in-results bar is open. */
  findOpen: boolean;
  /** The editor's font size (px). */
  fontSize: number;
  /** Query result columns, for menu export. */
  columns: string[];
  /** Query result rows, for menu export. */
  rows: Record<string, DbValue>[];
  /** Callbacks the editor wires up so menu actions can trigger them. */
  runCurrent: () => void;
  runAll: () => void;

  register: (api: {
    editor: SqlEditorStore["editor"];
    tabId: string;
    sql: string;
    findOpen: boolean;
    fontSize: number;
    columns: string[];
    rows: Record<string, DbValue>[];
    runCurrent: () => void;
    runAll: () => void;
  }) => void;
  setSql: (sql: string) => void;
  setFindOpen: (open: boolean) => void;
  setFontSize: (size: number) => void;
  setColumns: (columns: string[]) => void;
  setRows: (rows: Record<string, DbValue>[]) => void;
  getSql: (tabId: string) => string;
  toggleFind: () => void;
  toggleLineComment: () => void;
  adjustFontSize: (delta: number) => void;
}

export const useSqlEditorStore = create<SqlEditorStore>((set, get) => ({
  editor: null,
  tabId: null,
  sql: "",
  findOpen: false,
  fontSize: 12,
  columns: [],
  rows: [],
  runCurrent: () => {},
  runAll: () => {},

  register: (api) =>
    set({
      editor: api.editor,
      tabId: api.tabId,
      sql: api.sql,
      findOpen: api.findOpen,
      fontSize: api.fontSize,
      columns: api.columns,
      rows: api.rows,
      runCurrent: api.runCurrent,
      runAll: api.runAll,
    }),

  setSql: (sql) => set({ sql }),
  setFindOpen: (open) => set({ findOpen: open }),
  setFontSize: (size) => set({ fontSize: size }),
  setColumns: (columns) => set({ columns }),
  setRows: (rows) => set({ rows }),

  getSql: (tabId) => (get().tabId === tabId ? get().sql : ""),

  toggleFind: () => set((s) => ({ findOpen: !s.findOpen })),

  toggleLineComment: () => {
    const editor = get().editor;
    if (!editor) return;
    const selection = editor.getSelection();
    if (!selection) return;
    editor.executeEdits("menu", [
      { range: selection, text: editor.getModel()?.getValueInRange(selection) ?? "" },
    ]);
    editor.trigger("menu", "editor.action.commentLine", {});
  },

  adjustFontSize: (delta) => {
    const next = Math.min(24, Math.max(9, get().fontSize + delta));
    set({ fontSize: next });
  },
}));
