import { useState } from "react";
import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { useConnectionsStore, type SavedConnection } from "../../stores/connectionsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../ui/ContextMenu";
import { useDialogsStore } from "../../stores/dialogsStore";
import { DatabaseIcon, PlusIcon } from "../ui/icons";

interface ConnectionRailProps {
  onNewConnection: () => void;
}

function RailItem({ connection }: { connection: SavedConnection }) {
  const activeId = useConnectionsStore((s) => s.activeConnectionId);
  const setActive = useConnectionsStore((s) => s.setActiveConnection);
  const setConnected = useConnectionsStore((s) => s.setConnected);
  const removeConnection = useConnectionsStore((s) => s.removeConnection);
  const closeTabsFor = useTabsStore((s) => s.closeTabsForConnection);
  const queryClient = useQueryClient();
  const openEdit = useDialogsStore((s) => s.openEdit);
  const menu = useContextMenu();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isActive = activeId === connection.id;

  /** `force` reconnects even when we still believe the connection is live, for
   *  the case where the far end dropped it without us noticing yet. */
  async function connect(force = false) {
    if (busy) return;
    setActive(connection.id);
    if (connection.isConnected && !force) return;
    setBusy(true);
    setError(null);
    const result = await commands.connectSaved(connection.id);
    setBusy(false);
    if (result.status === "error") {
      setError(result.error.message);
      setConnected(connection.id, false);
      return;
    }
    setError(null);
    setConnected(connection.id, true);
    // The old pool's cached rows and schema belong to a connection that no
    // longer exists.
    for (const key of ["server-info", "databases", "schemas", "tables", "views", "rows"]) {
      queryClient.invalidateQueries({ queryKey: [key, connection.id] });
    }
  }

  async function disconnect() {
    await commands.closeConnection(connection.id);
    setConnected(connection.id, false);
    closeTabsFor(connection.id);
  }

  const items: MenuEntry[] = [
    connection.isConnected
      ? { label: "Disconnect", onSelect: disconnect }
      : { label: "Connect", onSelect: () => connect() },
    // Always offered: a connection dropped by the far end still looks live here
    // until the next heartbeat, and waiting for that isn't obvious.
    { label: "Reconnect", onSelect: () => connect(true) },
    // Editable whether or not it's connected; a live connection is reopened
    // with the new settings on save.
    { label: "Edit connection…", onSelect: () => openEdit(connection.id) },
    { label: "Copy name", onSelect: () => navigator.clipboard.writeText(connection.name) },
    null,
    {
      label: "Remove connection",
      danger: true,
      onSelect: async () => {
        await commands.deleteSavedConnection(connection.id);
        removeConnection(connection.id);
        closeTabsFor(connection.id);
        queryClient.invalidateQueries({ queryKey: ["saved-connections"] });
      },
    },
  ];

  return (
    <>
      <button
        onClick={() => connect()}
        onContextMenu={menu.open}
        title={error ?? connection.name}
        className={clsx(
          "group relative flex w-full flex-col items-center gap-1 px-1 py-2 transition-colors",
          isActive ? "bg-white/10" : "hover:bg-white/5",
        )}
      >
        {/* Active marker rides the connection's accent so environments stay
            distinguishable at a glance. */}
        <span
          className={clsx(
            "absolute left-0 top-1 bottom-1 w-[3px] rounded-r",
            isActive ? "opacity-100" : "opacity-0",
          )}
          style={{ backgroundColor: connection.accentColor }}
        />
        <span className="relative">
          <DatabaseIcon
            className="h-6 w-6"
            style={{ color: connection.isConnected ? connection.accentColor : "#6b7280" }}
          />
          {busy && (
            <span className="absolute -right-1 -top-1 h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          )}
          {error && (
            <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-red-500" />
          )}
        </span>
        <span
          className={clsx(
            "line-clamp-2 w-full break-all text-center text-[10px] leading-tight",
            isActive ? "text-neutral-200" : "text-neutral-500",
          )}
        >
          {connection.name}
        </span>
      </button>
      <ContextMenu position={menu.position} items={items} onClose={menu.close} />
    </>
  );
}

export function ConnectionRail({ onNewConnection }: ConnectionRailProps) {
  const connections = useConnectionsStore((s) => s.connections);

  return (
    <div className="flex w-[76px] shrink-0 flex-col border-r border-(--border-strong) bg-(--surface-sunken)">
      <div data-tauri-drag-region className="h-9 shrink-0" />
      <div className="flex-1 overflow-y-auto">
        {connections.map((c) => (
          <RailItem key={c.id} connection={c} />
        ))}
      </div>
      <button
        onClick={onNewConnection}
        title="New connection"
        className="flex h-10 shrink-0 items-center justify-center border-t border-black/30 text-neutral-500 transition-colors hover:bg-white/5 hover:text-neutral-200"
      >
        <PlusIcon className="h-4 w-4" />
      </button>
    </div>
  );
}
