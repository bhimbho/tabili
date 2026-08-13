import { create } from "zustand";

export interface OpenTab {
  id: string;
  connectionId: string;
  title: string;
  kind: "table" | "query";
}

interface TabsState {
  tabs: OpenTab[];
  activeTabId: string | null;
  openTab: (tab: OpenTab) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
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
  setActiveTab: (id) => set({ activeTabId: id }),
}));
