import { useTabsStore } from "../../stores/tabsStore";
import clsx from "clsx";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab } = useTabsStore();

  if (tabs.length === 0) {
    return <div data-tauri-drag-region className="h-9 shrink-0 border-b border-black/40" />;
  }

  return (
    <div data-tauri-drag-region className="flex h-9 shrink-0 items-stretch border-b border-black/40">
      {tabs.map((tab) => (
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
