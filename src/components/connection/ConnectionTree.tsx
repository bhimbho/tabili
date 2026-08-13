import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { useTables } from "../../hooks/useSchema";
import { useConnectionsStore, type SavedConnection } from "../../stores/connectionsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { DialectBadge } from "./DialectBadge";
import { TableIcon, ViewIcon } from "../ui/icons";

function ConnectionEntry({ connection }: { connection: SavedConnection }) {
  const { data: tables, isLoading, error } = useTables(connection.isConnected ? connection.id : null);
  const openTab = useTabsStore((s) => s.openTab);
  const setConnected = useConnectionsStore((s) => s.setConnected);
  const removeConnection = useConnectionsStore((s) => s.removeConnection);
  const queryClient = useQueryClient();
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  async function handleConnect() {
    if (connection.isConnected || connecting) return;
    setConnecting(true);
    setConnectError(null);
    const result = await commands.connectSaved(connection.id);
    setConnecting(false);
    if (result.status === "error") {
      setConnectError(result.error.message);
      return;
    }
    setConnected(connection.id, true);
  }

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation();
    await commands.deleteSavedConnection(connection.id);
    removeConnection(connection.id);
    queryClient.invalidateQueries({ queryKey: ["saved-connections"] });
  }

  return (
    <div>
      <div
        onClick={handleConnect}
        className="group flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-900"
        style={{ cursor: connection.isConnected ? "default" : "pointer" }}
      >
        <DialectBadge dialect={connection.dialect} size="sm" />
        <span className="min-w-0 flex-1 truncate">{connection.name}</span>
        {connecting && <span className="text-[10px] text-neutral-500">Connecting…</span>}
        {!connection.isConnected && !connecting && (
          <span className="text-[10px] text-neutral-600 opacity-0 group-hover:opacity-100">Click to connect</span>
        )}
        <button
          onClick={handleDelete}
          title="Remove connection"
          className="shrink-0 rounded px-1 text-neutral-600 opacity-0 hover:bg-neutral-800 hover:text-red-400 group-hover:opacity-100"
        >
          ×
        </button>
      </div>
      {connectError && <div className="px-2 py-1 text-xs text-red-400">{connectError}</div>}
      {connection.isConnected && (
        <div className="pl-6">
          {isLoading && <div className="px-2 py-1 text-xs text-neutral-500">Loading tables…</div>}
          {error && <div className="px-2 py-1 text-xs text-red-400">{(error as Error).message}</div>}
          {tables?.map((table) => (
            <button
              key={table.name}
              onClick={() =>
                openTab({
                  id: `${connection.id}:${table.name}`,
                  connectionId: connection.id,
                  title: table.name,
                  kind: "table",
                })
              }
              className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-xs text-neutral-400 transition-colors hover:bg-neutral-900 hover:text-neutral-100"
            >
              {table.isView ? (
                <ViewIcon className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
              ) : (
                <TableIcon className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
              )}
              <span className="truncate">{table.name}</span>
            </button>
          ))}
          {tables?.length === 0 && <div className="px-2 py-1 text-xs text-neutral-600">No tables.</div>}
        </div>
      )}
    </div>
  );
}

interface ConnectionTreeProps {
  search?: string;
}

export function ConnectionTree({ search = "" }: ConnectionTreeProps) {
  const connections = useConnectionsStore((s) => s.connections);
  const filtered = search.trim()
    ? connections.filter((c) => c.name.toLowerCase().includes(search.trim().toLowerCase()))
    : connections;

  if (filtered.length === 0) {
    return <div className="px-3 py-2 text-sm text-neutral-600">No matches.</div>;
  }

  return (
    <div className="space-y-0.5 py-1">
      {filtered.map((c) => (
        <ConnectionEntry key={c.id} connection={c} />
      ))}
    </div>
  );
}
