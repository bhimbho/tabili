import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { disableTextSubstitution } from "./lib/disableTextSubstitution";
import { initTheme } from "./stores/themeStore";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Schema metadata barely moves, and every refetch is a round trip to a
      // possibly remote server. The library default (always stale) re-ran every
      // mounted introspection query on each remount.
      staleTime: 60_000,
      // Alt-tabbing back into the app is not a reason to re-introspect the
      // database. Refreshing is an explicit action in the sidebar.
      refetchOnWindowFocus: false,
      // A failed query is nearly always a real error (bad SQL, dropped
      // connection), not a blip worth silently retrying three times.
      retry: false,
    },
  },
});

disableTextSubstitution();
initTheme();

// Suppress the webview's own "Inspect Element" menu so right-click can be handed
// to app-specific menus. Text inputs keep the native menu (cut/copy/paste).
document.addEventListener("contextmenu", (e) => {
  const target = e.target as HTMLElement | null;
  if (target?.closest("input, textarea, [contenteditable='true']")) return;
  e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
