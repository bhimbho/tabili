import { create } from "zustand";

export type ThemeMode = "dark" | "light";

const STORAGE_KEY = "tabili.theme";

function load(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "light" || raw === "dark") return raw;
    // Default: match the OS until the user picks a side.
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  } catch {
    return "dark";
  }
}

interface ThemeState {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  toggle: () => void;
}

/** The theme is a preference, persisted and applied as a `data-theme` attribute
 *  on <html> — every surface reads it off CSS variables (see index.css). */
export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: load(),
  setMode: (mode) => {
    document.documentElement.setAttribute("data-theme", mode);
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* localStorage unavailable — the choice just won't persist. */
    }
    set({ mode });
  },
  toggle: () => get().setMode(get().mode === "dark" ? "light" : "dark"),
}));

/** Applies the persisted (or OS-default) theme on startup, before the first
 *  frame paints to avoid a flash of the wrong mode. */
export function initTheme() {
  const mode = load();
  document.documentElement.setAttribute("data-theme", mode);
}
