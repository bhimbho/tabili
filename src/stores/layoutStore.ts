import { create } from "zustand";

const STORAGE_KEY = "tabili.layout";

interface Persisted {
  sidebarWidth: number;
  detailsWidth: number;
  sidebarVisible: boolean;
  detailsVisible: boolean;
}

const DEFAULTS: Persisted = {
  sidebarWidth: 300,
  detailsWidth: 300,
  sidebarVisible: true,
  detailsVisible: true,
};

/** Pane geometry is a preference, so it survives restarts. */
function load(): Persisted {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

interface LayoutState extends Persisted {
  setSidebarWidth: (w: number) => void;
  setDetailsWidth: (w: number) => void;
  toggleSidebar: () => void;
  toggleDetails: () => void;
  setDetailsVisible: (visible: boolean) => void;
}

export const useLayoutStore = create<LayoutState>((set, get) => {
  const persist = () => {
    const { sidebarWidth, detailsWidth, sidebarVisible, detailsVisible } = get();
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ sidebarWidth, detailsWidth, sidebarVisible, detailsVisible }),
      );
    } catch {
      // Storage being unavailable shouldn't break the layout.
    }
  };

  const update = (patch: Partial<Persisted>) => {
    set(patch as LayoutState);
    persist();
  };

  return {
    ...load(),
    setSidebarWidth: (w) => update({ sidebarWidth: w }),
    setDetailsWidth: (w) => update({ detailsWidth: w }),
    toggleSidebar: () => update({ sidebarVisible: !get().sidebarVisible }),
    toggleDetails: () => update({ detailsVisible: !get().detailsVisible }),
    setDetailsVisible: (visible) => update({ detailsVisible: visible }),
  };
});
