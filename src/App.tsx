import { useEffect, useState } from "react";
import { AppShell } from "./components/layout/AppShell";
import { TableView } from "./components/grid/TableView";
import { commands } from "./bindings";
import { useTabsStore } from "./stores/tabsStore";
import { useConnectionsStore } from "./stores/connectionsStore";
import { useSavedConnections } from "./hooks/useConnections";

function MainPane() {
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId));

  if (!activeTab) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-center">
        <p className="text-sm font-medium text-neutral-300">No table open</p>
        <p className="text-sm text-neutral-600">Pick a connection in the sidebar, then a table to browse it.</p>
      </div>
    );
  }

  return <TableView connectionId={activeTab.connectionId} table={activeTab.title} />;
}

function App() {
  const [appVersion, setAppVersion] = useState<string>();
  const { data: saved } = useSavedConnections();
  const setConnections = useConnectionsStore((s) => s.setConnections);

  useEffect(() => {
    commands.appInfo().then((info) => setAppVersion(info.version));
  }, []);

  useEffect(() => {
    if (saved) setConnections(saved.map((c) => ({ id: c.id, name: c.name, dialect: c.dialect })));
  }, [saved, setConnections]);

  return (
    <AppShell appVersion={appVersion}>
      <MainPane />
    </AppShell>
  );
}

export default App;
