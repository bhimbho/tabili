import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import App from "./App";
import { disableTextSubstitution } from "./lib/disableTextSubstitution";
import { initTheme } from "./stores/themeStore";
import "./index.css";

const queryClient = new QueryClient();

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
