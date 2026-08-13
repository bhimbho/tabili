import { useConnectionsStore } from "../../stores/connectionsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useServerInfo } from "../../hooks/useConnections";

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
    </header>
  );
}
