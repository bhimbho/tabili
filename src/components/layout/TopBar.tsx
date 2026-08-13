import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useChangesStore } from "../../stores/changesStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useServerInfo } from "../../hooks/useConnections";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { PanelIcon, PanelRightIcon, ReloadIcon } from "../ui/icons";

/** Connections marked red are treated as production. */
function isDanger(color?: string | null) {
  if (!color) return false;
  const c = color.toLowerCase();
  return c === "#ef4444" || c === "#dc2626" || c === "#b91c1c";
}

const iconButton =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 disabled:opacity-30 disabled:hover:bg-transparent";

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

  const connection = connections.find((c) => c.id === activeId);
  const { data: info } = useServerInfo(connection?.isConnected ? activeId : null);
  const schema = activeId ? activeSchema[activeId] : undefined;
  const danger = isDanger(connection?.accentColor);

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

  // Reads left-to-right from the server down to the open table.
  const crumbs = [
    info?.version,
    info?.database,
    activeTab ? `${schema ? `${schema}.` : ""}${activeTab.title}` : null,
  ].filter(Boolean) as string[];

  return (
    <header
      data-tauri-drag-region
      className="flex h-11 shrink-0 items-center gap-1.5 border-b px-3"
      style={{
        // Traffic lights overlay this bar's left edge when the sidebar is hidden.
        paddingLeft: sidebarVisible ? undefined : 82,
        borderColor: connection ? `${connection.accentColor}55` : undefined,
        backgroundColor: connection ? `${connection.accentColor}14` : undefined,
      }}
    >
      <button
        onClick={toggleSidebar}
        title={sidebarVisible ? "Hide sidebar" : "Show sidebar"}
        className={iconButton}
      >
        <PanelIcon className="h-4 w-4" />
      </button>
      <button
        onClick={handleReload}
        disabled={!connection?.isConnected}
        title="Reload connection"
        className={iconButton}
      >
        <ReloadIcon className="h-4 w-4" />
      </button>

      <div data-tauri-drag-region className="flex min-w-0 flex-1 justify-center px-2">
        {connection ? (
          <div
            className="flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-black/25 px-3 py-1"
            style={{ boxShadow: danger ? "inset 0 0 0 1px rgba(239,68,68,0.45)" : undefined }}
          >
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                backgroundColor: connection.isConnected ? connection.accentColor : "#6b7280",
              }}
              title={connection.isConnected ? "Connected" : "Not connected"}
            />
            <span
              className="shrink-0 text-xs font-semibold uppercase tracking-wide"
              style={{ color: danger ? "#fca5a5" : "#e5e5e5" }}
            >
              {connection.name}
            </span>
            {crumbs.length > 0 && (
              <span className="truncate text-xs text-neutral-400">
                <span className="text-neutral-600">|</span> {crumbs.join("  :  ")}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-neutral-600">No connection selected</span>
        )}
      </div>

      <button
        onClick={toggleDetails}
        title={detailsVisible ? "Hide details" : "Show details"}
        className={`${iconButton} ${detailsVisible ? "text-neutral-200" : ""}`}
      >
        <PanelRightIcon className="h-4 w-4" />
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
