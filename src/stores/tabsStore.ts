import { create } from "zustand";

export interface OpenTab {
  id: string;
  connectionId: string;
  title: string;
  kind: "table" | "query" | "erd";
  /** null for SQLite / driver default. */
  schema: string | null;
  /** Set when the tab was opened by following a foreign key. */
  seedFilter?: { column: string; value: string };
}

interface TabsState {
  tabs: OpenTab[];
  activeTabId: string | null;
  openTab: (tab: OpenTab) => void;
  closeTab: (id: string) => void;
  closeTabsForConnection: (connectionId: string) => void;
  setActiveTab: (id: string | null) => void;
}

export const useTabsStore = create<TabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  openTab: (tab) =>
    set((state) => ({
      tabs: state.tabs.some((t) => t.id === tab.id) ? state.tabs : [...state.tabs, tab],
      activeTabId: tab.id,
    })),
  closeTab: (id) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.id !== id);
      const wasActive = get().activeTabId === id;
      return {
        tabs,
        activeTabId: wasActive ? (tabs[tabs.length - 1]?.id ?? null) : state.activeTabId,
      };
    }),
  closeTabsForConnection: (connectionId) =>
    set((state) => {
      const tabs = state.tabs.filter((t) => t.connectionId !== connectionId);
      const activeStillOpen = tabs.some((t) => t.id === state.activeTabId);
      return {
        tabs,
        activeTabId: activeStillOpen ? state.activeTabId : (tabs[tabs.length - 1]?.id ?? null),
      };
    }),

  setActiveTab: (id) => set({ activeTabId: id }),
}));
