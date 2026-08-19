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
    return <div data-tauri-drag-region className="h-9 shrink-0 border-b border-black/40" />;
  }

  return (
    <div data-tauri-drag-region className="flex h-9 shrink-0 items-stretch border-b border-black/40">
      {visible.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={clsx(
            "group flex items-center gap-2 border-r border-black/40 px-3 text-sm",
            tab.id === activeTabId
              ? "bg-white/[0.06] text-neutral-100 shadow-[inset_0_-2px_0_0_rgba(99,102,241,0.9)]"
              : "text-neutral-400 hover:bg-neutral-900/60",
          )}
        >
          {tab.title}
          <span
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.id);
            }}
            className="rounded px-1 text-neutral-500 opacity-0 hover:bg-neutral-800 group-hover:opacity-100"
          >
            ×
          </span>
        </button>
      ))}
    </div>
  );
}
