import { useConnectionsStore } from "../../stores/connectionsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useServerInfo } from "../../hooks/useConnections";
import { useLayoutStore } from "../../stores/layoutStore";
import { useChangesStore } from "../../stores/changesStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PanelIcon, ReloadIcon } from "../ui/icons";

/** Warn-styled header for connections the user has marked red (production). */
function isDanger(color?: string | null) {
  if (!color) return false;
  const c = color.toLowerCase();
  return c === "#ef4444" || c === "#dc2626" || c === "#b91c1c";
}

export function TopBar() {
  const activeId = useConnectionsStore((s) => s.activeConnectionId);
  const connections = useConnectionsStore((s) => s.connections);
  const activeSchema = useConnectionsStore((s) => s.activeSchema);
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const { sidebarVisible, toggleSidebar, detailsVisible, toggleDetails } = useLayoutStore();
  const pendingCount = useChangesStore((s) => s.count());
  const discardAll = useChangesStore((s) => s.discardAll);
  const queryClient = useQueryClient();
  const [confirmReload, setConfirmReload] = useState(false);

  /** Drops every cached query for this connection, from schema list to rows. */
  function reloadConnection() {
    if (!activeId) return;
    for (const key of [
      "server-info", "databases", "schemas", "tables", "views",
      "columns", "indexes", "foreign-keys", "triggers", "table-ddl", "rows",
    ]) {
      queryClient.invalidateQueries({ queryKey: [key, activeId] });
    }
  }

  function handleReload() {
    // Reloading replaces the rows staged edits were made against, so those edits
    // would silently point at stale data — make the user choose.
    if (pendingCount > 0) {
      setConfirmReload(true);
      return;
    }
    reloadConnection();
  }

  const connection = connections.find((c) => c.id === activeId);
  const { data: info } = useServerInfo(connection?.isConnected ? activeId : null);

  const schema = activeId ? activeSchema[activeId] : undefined;
  const danger = isDanger(connection?.accentColor);

  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-3 border-b px-3"
      style={{
        borderColor: connection ? `${connection.accentColor}55` : undefined,
        // A tinted header makes it obvious which environment you're editing.
        backgroundColor: connection ? `${connection.accentColor}14` : undefined,
      }}
    >
      <button
        onClick={toggleSidebar}
        title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        className={`shrink-0 rounded-md p-1 transition-colors hover:bg-white/10 ${
          sidebarVisible ? "text-neutral-300" : "text-neutral-600"
        }`}
      >
        <PanelIcon className="h-4 w-4" />
      </button>

      <button
        onClick={handleReload}
        disabled={!connection?.isConnected}
        title="Reload connection"
        className="shrink-0 rounded-md p-1 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent"
      >
        <ReloadIcon className="h-4 w-4" />
      </button>

      {connection ? (
        <>
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: connection.isConnected ? connection.accentColor : "#6b7280" }}
            title={connection.isConnected ? "Connected" : "Not connected"}
          />
          <span className="shrink-0 text-xs font-semibold text-neutral-100">{connection.name}</span>

          {danger && (
            <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-red-300 ring-1 ring-red-500/50">
              Production
            </span>
          )}

          <span className="shrink-0 text-xs text-neutral-500">
            {info?.version ?? (connection.isConnected ? "…" : "Disconnected")}
          </span>

          {info?.database && (
            <span className="shrink-0 text-xs text-neutral-500">· {info.database}</span>
          )}

          {activeTab && (
            <span className="truncate text-xs text-neutral-300">
              · {schema ? `${schema}.` : ""}
              <span className="font-medium">{activeTab.title}</span>
            </span>
          )}
        </>
      ) : (
        <span className="text-xs text-neutral-600">No connection selected</span>
      )}
      <button
        onClick={toggleDetails}
        title={detailsVisible ? "Hide details" : "Show details"}
        className={`ml-auto shrink-0 rounded-md px-2 py-0.5 text-xs transition-colors hover:bg-white/10 ${
          detailsVisible ? "text-neutral-300" : "text-neutral-600"
        }`}
      >
        Details
      </button>

      <ConfirmDialog
        open={confirmReload}
        title="Discard unsaved changes?"
        description={`You have ${pendingCount} unsaved change${
          pendingCount === 1 ? "" : "s"
        }. Reloading refetches every table on this connection, so those changes will be discarded.`}
        confirmLabel="Discard and reload"
        danger
        onConfirm={() => {
          discardAll();
          reloadConnection();
          setConfirmReload(false);
        }}
        onCancel={() => setConfirmReload(false)}
      />
    </header>
  );
}
