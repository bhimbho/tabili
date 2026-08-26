import { useEffect, useState } from "react";
import { useIsFetching, useQueryClient } from "@tanstack/react-query";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useChangesStore } from "../../stores/changesStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useThemeStore } from "../../stores/themeStore";
import { useServerInfo } from "../../hooks/useConnections";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { DragRegion } from "../ui/DragRegion";
import { MoonIcon, PanelIcon, PanelRightIcon, ReloadIcon, SunIcon } from "../ui/icons";

/** Connections marked red are treated as production. */
function isDanger(color?: string | null) {
  if (!color) return false;
  const c = color.toLowerCase();
  return c === "#ef4444" || c === "#dc2626" || c === "#b91c1c";
}

const iconButton =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-(--text-faint) transition-colors hover:bg-(--hover) hover:text-(--text) disabled:opacity-30 disabled:hover:bg-transparent";

export function TopBar() {
  const activeId = useConnectionsStore((s) => s.activeConnectionId);
  const connections = useConnectionsStore((s) => s.connections);
  const activeSchema = useConnectionsStore((s) => s.activeSchema);
  const setConnected = useConnectionsStore((s) => s.setConnected);
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const { sidebarVisible, toggleSidebar, detailsVisible, toggleDetails } = useLayoutStore();
  const { mode: themeMode, toggle: toggleTheme } = useThemeStore();
  const pendingCount = useChangesStore((s) => s.count());
  const discardAll = useChangesStore((s) => s.discardAll);
  const queryClient = useQueryClient();
  const [confirmReload, setConfirmReload] = useState(false);
  // Any in-flight query for this connection counts as "still loading".
  const fetching = useIsFetching() > 0;

  const connection = connections.find((c) => c.id === activeId);
  const { data: info, error: infoError } = useServerInfo(
    connection?.isConnected ? activeId : null,
  );

  // The heartbeat failing means the server (or the SSH tunnel under it) went
  // away. Recording that is what re-enables Connect — the rail ignores clicks
  // on something it still believes is connected.
  useEffect(() => {
    if (infoError && activeId) setConnected(activeId, false);
  }, [infoError, activeId, setConnected]);
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
    <DragRegion
      className="relative flex h-11 shrink-0 items-center gap-1.5 border-b px-3"
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
        data-no-drag
      >
        <PanelIcon className="h-4 w-4" />
      </button>
      <button
        onClick={handleReload}
        disabled={!connection?.isConnected}
        title="Reload connection"
        className={iconButton}
        data-no-drag
      >
        <ReloadIcon className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
      </button>

      <div className="flex min-w-0 flex-1 justify-center px-2">
        {connection ? (
          <div
            className="flex min-w-0 max-w-full items-center gap-2 rounded-lg bg-(--surface-sunken) px-3 py-1"
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
              style={{ color: danger ? "#f87171" : "var(--text)" }}
            >
              {connection.name}
            </span>
            {crumbs.length > 0 && (
              <span className="truncate text-xs text-(--text-muted)">
                <span className="text-(--text-faint)">|</span> {crumbs.join("  :  ")}
              </span>
            )}
          </div>
        ) : (
          <span className="text-xs text-(--text-faint)">No connection selected</span>
        )}
      </div>

      <button
        onClick={toggleDetails}
        title={detailsVisible ? "Hide details" : "Show details"}
        className={`${iconButton} ${detailsVisible ? "text-(--text)" : ""}`}
        data-no-drag
      >
        <PanelRightIcon className="h-4 w-4" />
      </button>
      <button
        onClick={toggleTheme}
        title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        className={iconButton}
        data-no-drag
      >
        {themeMode === "dark" ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
      </button>

      {fetching && (
        <div
          className="progress-strip pointer-events-none absolute inset-x-0 bottom-0 h-0.5 overflow-hidden"
          style={{ color: connection?.accentColor ?? "#6366f1" }}
        />
      )}

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
    </DragRegion>
  );
}
