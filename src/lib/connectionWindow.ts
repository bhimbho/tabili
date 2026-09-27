import { getCurrentWindow } from "@tauri-apps/api/window";
import { commands } from "../bindings";
import { useConnectionsStore } from "../stores/connectionsStore";
import { useTabsStore, type OpenTab } from "../stores/tabsStore";

/**
 * Moving a connection to its own window means handing over the tabs it had open,
 * and a query string is the wrong place for that much data. Both windows share
 * one origin, so local storage carries the payload across: the source window
 * writes it, the new window reads it once and deletes it.
 */
interface Handoff {
  tabs: OpenTab[];
  activeTabId: string | null;
  /** The connection's selected schema, which is otherwise per-window state. */
  schema?: string;
}

const HANDOFF_PREFIX = "tabili.handoff.";

/** Set when this window was opened for one connection by "Move to new window". */
export const WINDOW_CONNECTION_ID: string | null = new URLSearchParams(
  window.location.search,
).get("connection");

function handoffKey(connectionId: string) {
  return `${HANDOFF_PREFIX}${connectionId}`;
}

/**
 * Opens a window owned by `connectionId` and moves this window's tabs for that
 * connection into it. The connection stays in the sidebar here — it is the saved
 * list, shared by every window — but its tabs, and anything opened from them,
 * now live in the new window.
 */
export async function moveConnectionToNewWindow(connectionId: string): Promise<string | null> {
  const { tabs, activeTabId } = useTabsStore.getState();
  const moving = tabs.filter((t) => t.connectionId === connectionId);
  const connections = useConnectionsStore.getState();
  const name = connections.connections.find((c) => c.id === connectionId)?.name ?? "Tabili";

  const payload: Handoff = {
    tabs: moving,
    activeTabId: moving.some((t) => t.id === activeTabId) ? activeTabId : null,
    schema: connections.activeSchema[connectionId],
  };

  try {
    localStorage.setItem(handoffKey(connectionId), JSON.stringify(payload));
  } catch {
    // Without the handoff the new window simply opens with no tabs, which is
    // a worse move but not a broken one.
  }

  const result = await commands.openConnectionWindow(connectionId, name);
  if (result.status === "error") {
    try {
      localStorage.removeItem(handoffKey(connectionId));
    } catch {
      // Nothing to clean up if storage is unavailable.
    }
    return result.error.message;
  }

  // Only now drop them here: a failed move must not lose the user's tabs.
  useTabsStore.getState().closeTabsForConnection(connectionId);
  const remaining = useTabsStore.getState().tabs;
  if (connections.activeConnectionId === connectionId) {
    const next = remaining[remaining.length - 1]?.connectionId ?? null;
    useConnectionsStore.getState().setActiveConnection(next);
  }
  return null;
}

/** Reads and clears the handoff left for this window, if there is one. */
export function takeHandoff(connectionId: string): Handoff | null {
  try {
    const raw = localStorage.getItem(handoffKey(connectionId));
    if (!raw) return null;
    localStorage.removeItem(handoffKey(connectionId));
    const parsed = JSON.parse(raw) as Handoff;
    // Tabs from another connection would query the wrong server.
    const tabs = (parsed.tabs ?? []).filter((t) => t.connectionId === connectionId);
    return { ...parsed, tabs };
  } catch {
    return null;
  }
}

/** Names the window after the connection it owns, so the two are tellable apart. */
export async function setWindowTitle(title: string) {
  try {
    await getCurrentWindow().setTitle(title);
  } catch {
    // A title we cannot set is cosmetic.
  }
}
