import { useEffect, useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import { TableView } from "./components/grid/TableView";
import { SqlEditor } from "./components/connection/SqlEditor";
import { ExportDialog } from "./components/transfer/ExportDialog";
import { ImportDialog } from "./components/transfer/ImportDialog";
import { commands } from "./bindings";
import { useTabsStore } from "./stores/tabsStore";
import { useConnectionsStore } from "./stores/connectionsStore";
import { useDialogsStore } from "./stores/dialogsStore";
import { useSavedConnections } from "./hooks/useConnections";
import { useMenuActions } from "./hooks/useMenuActions";

function MainPane() {
  const activeConnectionId = useConnectionsStore((s) => s.activeConnectionId);
  const tab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  // Between switching connection and the tab bar re-pointing the active tab,
  // this would otherwise render the previous connection's table for a frame.
  const activeTab = tab && tab.connectionId === activeConnectionId ? tab : undefined;

  if (!activeTab) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium text-(--text-muted)">No table open</p>
        <p className="text-sm text-(--text-faint)">Pick a connection in the sidebar, then a table to browse it.</p>
      </div>
    );
  }

  if (activeTab.kind === "query") {
    return <SqlEditor key={activeTab.id} tabId={activeTab.id} connectionId={activeTab.connectionId} />;
  }

  return (
    // Keyed by tab: without it React reuses one TableView across tabs, and its
    // sort and filter state — column names from the previous table — carry over
    // and fail the next table's query.
    <TableView
      key={activeTab.id}
      connectionId={activeTab.connectionId}
      table={activeTab.title}
      schema={activeTab.schema}
      seedFilter={activeTab.seedFilter}
    />
  );
}

/** Export/import live at the app level so the menu can open them from anywhere. */
function TransferDialogs() {
  const dialog = useDialogsStore((s) => s.dialog);
  const close = useDialogsStore((s) => s.close);

  switch (dialog) {
    case "export-all":
      return <ExportDialog mode="all" onClose={close} />;
    case "export-table":
      return <ExportDialog mode="table" onClose={close} />;
    case "import-csv":
      return <ImportDialog source="csv" onClose={close} />;
    case "import-sql":
      return <ImportDialog source="sql" onClose={close} />;
    default:
      return null;
  }
}

function App() {
  const [appVersion, setAppVersion] = useState<string>();
  const { data: saved } = useSavedConnections();
  const setConnections = useConnectionsStore((s) => s.setConnections);
  useMenuActions();

  useEffect(() => {
    commands.appInfo().then((info) => setAppVersion(info.version));
  }, []);

  useEffect(() => {
    if (saved) {
      setConnections(
        saved.map((c) => ({ id: c.id, name: c.name, dialect: c.dialect, color: c.color })),
      );
      // Keep File ▸ Open Recent in step with the saved list.
      void commands.refreshMenu();
    }
  }, [saved, setConnections]);

  return (
    <AppShell appVersion={appVersion}>
      <MainPane />
      <TransferDialogs />
    </AppShell>
  );
}

export default App;
