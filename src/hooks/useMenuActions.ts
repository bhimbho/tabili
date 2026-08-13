import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { commands, type DbValue } from "../bindings";
import { commitChanges } from "../lib/commitChanges";
import { useChangesStore } from "../stores/changesStore";
import { useConsoleStore } from "../stores/consoleStore";
import { useConnectionsStore } from "../stores/connectionsStore";
import { useDetailsStore } from "../stores/detailsStore";
import { useDialogsStore } from "../stores/dialogsStore";
import { useLayoutStore } from "../stores/layoutStore";
import { useTabsStore } from "../stores/tabsStore";

/** Prefix used by the dynamically-built File ▸ Open Recent entries. */
const RECENT_PREFIX = "recent:";

/** Query keys that together make up "everything cached for a connection". */
const CONNECTION_KEYS = [
  "server-info", "databases", "schemas", "tables", "views",
  "columns", "indexes", "foreign-keys", "triggers", "table-ddl", "rows",
];

function reloadConnection(queryClient: QueryClient, connectionId: string) {
  for (const key of CONNECTION_KEYS) {
    queryClient.invalidateQueries({ queryKey: [key, connectionId] });
  }
}

/** The primary key of the row currently shown in the Details pane, if any. */
function selectedRowPk(): {
  pk: Record<string, DbValue>;
  ctx: { connectionId: string; table: string; schema: string | null };
} | null {
  const { context, row } = useDetailsStore.getState();
  if (!context || !row) return null;
  const pkColumns = context.columnInfos.filter((c) => c.isPrimaryKey).map((c) => c.name);
  if (pkColumns.length === 0) return null;

  const pk: Record<string, DbValue> = {};
  for (const name of pkColumns) {
    const value = row[name];
    if (value === undefined) return null;
    pk[name] = value;
  }
  return {
    pk,
    ctx: { connectionId: context.connectionId, table: context.table, schema: context.schema },
  };
}

async function commit(queryClient: QueryClient) {
  if (useChangesStore.getState().count() === 0) return;
  const errors = await commitChanges(queryClient);
  if (errors.length > 0) {
    // commitChanges already logged the detail; surface the console on failure.
    useConsoleStore.getState().setOpen(true);
  }
}

/**
 * Handles clicks from the native menu. Actions that need no context (toggling a
 * pane) always work; the rest no-op when there is no active connection or tab,
 * which is why the menu items themselves aren't enabled/disabled per-context.
 */
async function dispatch(action: string, queryClient: QueryClient) {
  const dialogs = useDialogsStore.getState();
  const connections = useConnectionsStore.getState();
  const tabs = useTabsStore.getState();
  const layout = useLayoutStore.getState();
  const activeId = connections.activeConnectionId;

  if (action.startsWith(RECENT_PREFIX)) {
    const id = action.slice(RECENT_PREFIX.length);
    const result = await commands.connectSaved(id);
    if (result.status === "ok") connections.setConnected(id, true);
    return;
  }

  switch (action) {
    // --- File ---
    case "file.open":
    case "connection.new":
    case "connection.open":
      dialogs.open("new-connection");
      return;
    case "connection.edit":
      if (activeId) dialogs.openEdit(activeId);
      return;
    case "file.export":
      dialogs.open("export-all");
      return;
    case "file.export-table-columns":
      dialogs.open("export-table");
      return;
    case "file.import-csv":
      dialogs.open("import-csv");
      return;
    case "file.import-sql":
      dialogs.open("import-sql");
      return;
    case "file.close-tab":
      if (tabs.activeTabId) tabs.closeTab(tabs.activeTabId);
      return;

    // --- Edit ---
    case "edit.commit":
      await commit(queryClient);
      return;
    case "edit.discard":
      useChangesStore.getState().discardAll();
      return;
    case "edit.preview":
      dialogs.open("preview-changes");
      return;
    case "edit.add-row": {
      const tab = tabs.tabs.find((t) => t.id === tabs.activeTabId);
      if (!tab) return;
      useChangesStore.getState().addInsert(
        { connectionId: tab.connectionId, table: tab.title, schema: tab.schema },
        crypto.randomUUID(),
      );
      return;
    }
    case "edit.duplicate-row": {
      const { context, row } = useDetailsStore.getState();
      if (!context || !row) return;
      const changes = useChangesStore.getState();
      const tempId = crypto.randomUUID();
      const ctx = {
        connectionId: context.connectionId,
        table: context.table,
        schema: context.schema,
      };
      changes.addInsert(ctx, tempId);
      // Primary keys are left blank so the server assigns fresh ones rather
      // than the copy colliding with the row it came from.
      for (const info of context.columnInfos) {
        if (info.isPrimaryKey) continue;
        const value = row[info.name];
        if (value !== undefined) changes.setInsertValue(tempId, ctx, info.name, value);
      }
      return;
    }
    case "edit.delete-row": {
      const selected = selectedRowPk();
      if (!selected) return;
      useChangesStore.getState().toggleDelete(selected.ctx, selected.pk);
      return;
    }
    // --- View ---
    case "view.toggle-sidebar":
      layout.toggleSidebar();
      return;
    case "view.toggle-details":
      layout.toggleDetails();
      return;
    case "view.toggle-console":
      useConsoleStore.getState().toggle();
      return;

    // --- Connection ---
    case "connection.reload":
      if (activeId) reloadConnection(queryClient, activeId);
      return;
    case "connection.reload-tab": {
      const tab = tabs.tabs.find((t) => t.id === tabs.activeTabId);
      if (!tab) return;
      queryClient.invalidateQueries({
        queryKey: ["rows", tab.connectionId, tab.schema, tab.title],
      });
      return;
    }
    case "connection.reconnect": {
      if (!activeId) return;
      const result = await commands.connectSaved(activeId);
      if (result.status === "ok") {
        connections.setConnected(activeId, true);
        reloadConnection(queryClient, activeId);
      }
      return;
    }
    case "connection.disconnect": {
      if (!activeId) return;
      const result = await commands.closeConnection(activeId);
      if (result.status === "ok") {
        connections.setConnected(activeId, false);
        tabs.closeTabsForConnection(activeId);
      }
      return;
    }
  }
}

/**
 * Subscribes to native menu clicks. Accelerators live on the menu items
 * themselves, so there is deliberately no keydown listener here — having both
 * would fire each shortcut twice.
 */
export function useMenuActions() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const unlisten = listen<string>("menu-action", (event) => {
      void dispatch(event.payload, queryClient);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [queryClient]);
}
