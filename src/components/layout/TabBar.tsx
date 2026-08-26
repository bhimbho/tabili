import { useEffect, useMemo } from "react";
import clsx from "clsx";
import { useTabsStore } from "../../stores/tabsStore";
import { useConnectionsStore } from "../../stores/connectionsStore";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabsStore();
  const activeConnectionId = useConnectionsStore((s) => s.activeConnectionId);

  // Tabs belong to the connection they were opened from; showing another
  // connection's tabs here invites opening one and querying the wrong server.
  const visible = useMemo(
    () => tabs.filter((t) => t.connectionId === activeConnectionId),
    [tabs, activeConnectionId],
  );

  // Switching connection leaves the active tab pointing at the previous one's,
  // so move it to something belonging to the connection now in view.
  useEffect(() => {
    if (visible.some((t) => t.id === activeTabId)) return;
    setActiveTab(visible[visible.length - 1]?.id ?? null);
  }, [visible, activeTabId, setActiveTab]);

  if (visible.length === 0) {
    return <div data-tauri-drag-region className="h-9 shrink-0 border-b border-(--border)" />;
  }

  return (
    <div data-tauri-drag-region className="flex h-9 shrink-0 items-stretch border-b border-(--border)">
      {visible.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={clsx(
            "group flex items-center gap-2 border-r border-(--border) px-3 text-sm",
            tab.id === activeTabId
              ? "bg-(--active) text-(--text) shadow-[inset_0_-2px_0_0_var(--accent)]"
              : "text-(--text-muted) hover:bg-(--hover)",
          )}
        >
          {tab.title}
          <span
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
            className="rounded px-1 text-(--text-faint) opacity-0 hover:bg-(--active) group-hover:opacity-100"
          >
            ×
          </span>
        </button>
      ))}
    </div>
  );
}
