import { useTabsStore } from "../../stores/tabsStore";
import clsx from "clsx";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabsStore();

  if (tabs.length === 0) {
    return <div data-tauri-drag-region className="h-9 shrink-0 border-b border-neutral-800" />;
  }

  return (
    <div data-tauri-drag-region className="flex h-9 shrink-0 items-stretch border-b border-neutral-800">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          className={clsx(
            "group flex items-center gap-2 border-r border-neutral-800 px-3 text-sm",
            tab.id === activeTabId
              ? "bg-neutral-950 text-neutral-100"
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
