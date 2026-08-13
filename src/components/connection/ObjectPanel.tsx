import { useMemo, useState } from "react";
import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import { useSchemas, useTables, useViews } from "../../hooks/useSchema";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { ContextMenu, useContextMenu, type MenuEntry } from "../ui/ContextMenu";
import { Select } from "../ui/Select";
import { ChevronIcon, TableIcon, ViewIcon } from "../ui/icons";

type PanelTab = "items" | "queries" | "history";

const TABS: { key: PanelTab; label: string; enabled: boolean }[] = [
  { key: "items", label: "Items", enabled: true },
  { key: "queries", label: "Queries", enabled: false },
  { key: "history", label: "History", enabled: false },
];

function Group({
  title,
  count,
  children,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-neutral-500 transition-colors hover:text-neutral-300"
      >
        <ChevronIcon className={clsx("h-2.5 w-2.5 transition-transform", open && "rotate-90")} />
        {title}
        <span className="ml-auto font-normal text-neutral-600">{count}</span>
      </button>
      {open && <div>{children}</div>}
    </div>
  );
}

export function ObjectPanel() {
  const connectionId = useConnectionsStore((s) => s.activeConnectionId);
  const connections = useConnectionsStore((s) => s.connections);
  const activeSchema = useConnectionsStore((s) => s.activeSchema);
  const setActiveSchema = useConnectionsStore((s) => s.setActiveSchema);
  const openTab = useTabsStore((s) => s.openTab);
  const queryClient = useQueryClient();

  const [tab, setTab] = useState<PanelTab>("items");
  const [search, setSearch] = useState("");
  const [menuTable, setMenuTable] = useState<string | null>(null);
  const menu = useContextMenu();

  const connection = connections.find((c) => c.id === connectionId);
  const connected = connection?.isConnected ?? false;
  const schema = connectionId ? activeSchema[connectionId] : undefined;

  const { data: schemas } = useSchemas(connected ? connectionId : null);
  const { data: tables, isLoading, error } = useTables(connected ? connectionId : null, schema);
  const { data: views } = useViews(connected ? connectionId : null, schema);

  const needle = search.trim().toLowerCase();
  const match = (n: string) => !needle || n.toLowerCase().includes(needle);
  const shownTables = useMemo(() => (tables ?? []).filter((t) => match(t.name)), [tables, needle]);
  const shownViews = useMemo(() => (views ?? []).filter((v) => match(v.name)), [views, needle]);

  function open(name: string) {
    if (!connectionId) return;
    openTab({
      id: `${connectionId}:${schema ?? ""}:${name}`,
      connectionId,
      title: name,
      kind: "table",
      schema: schema ?? null,
    });
  }

  const menuItems: MenuEntry[] = [
    { label: "Open", onSelect: () => menuTable && open(menuTable) },
    { label: "Copy name", onSelect: () => menuTable && navigator.clipboard.writeText(menuTable) },
    null,
    {
      label: "Refresh",
      onSelect: () => {
        queryClient.invalidateQueries({ queryKey: ["tables", connectionId] });
        queryClient.invalidateQueries({ queryKey: ["views", connectionId] });
      },
    },
  ];

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-neutral-600">
        Select a connection on the left, or add one with +
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div data-tauri-drag-region className="h-7 shrink-0" />

      <div className="flex shrink-0 items-center gap-0.5 px-2 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            disabled={!t.enabled}
            onClick={() => setTab(t.key)}
            title={t.enabled ? undefined : "Coming with the SQL editor"}
            className={clsx(
              "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
              tab === t.key ? "bg-white/10 text-neutral-100" : "text-neutral-500 hover:text-neutral-300",
              !t.enabled && "cursor-not-allowed opacity-40 hover:text-neutral-500",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="shrink-0 px-2 pb-2">
        <div className="relative">
          <svg
            className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-neutral-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search for item…"
            className="w-full rounded-md border border-black/30 bg-black/20 py-1 pl-7 pr-6 text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-500 focus:border-neutral-500"
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-neutral-500 hover:text-neutral-200"
            >
              ×
            </button>
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {!connected && (
          <p className="px-3 py-2 text-xs text-neutral-600">Not connected. Click its icon to connect.</p>
        )}
        {connected && isLoading && <p className="px-3 py-2 text-xs text-neutral-500">Loading…</p>}
        {connected && error && (
          <p className="px-3 py-2 text-xs text-red-400">{(error as Error).message}</p>
        )}

        {connected && !isLoading && !error && (
          <>
            <Group title="Tables" count={shownTables.length}>
              {shownTables.map((t) => (
                <button
                  key={t.name}
                  onClick={() => open(t.name)}
                  onContextMenu={(e) => {
                    setMenuTable(t.name);
                    menu.open(e);
                  }}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 pl-5 text-left text-xs text-neutral-400 transition-colors hover:bg-white/5 hover:text-neutral-100"
                >
                  <TableIcon className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
              {shownTables.length === 0 && (
                <p className="px-2 py-1 pl-5 text-xs text-neutral-600">
                  {needle ? "No matches." : "No tables."}
                </p>
              )}
            </Group>

            {shownViews.length > 0 && (
              <Group title="Views" count={shownViews.length}>
                {shownViews.map((v) => (
                  <button
                    key={v.name}
                    onClick={() => open(v.name)}
                    onContextMenu={(e) => {
                      setMenuTable(v.name);
                      menu.open(e);
                    }}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 pl-5 text-left text-xs text-neutral-400 transition-colors hover:bg-white/5 hover:text-neutral-100"
                  >
                    <ViewIcon className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                    <span className="truncate">{v.name}</span>
                  </button>
                ))}
              </Group>
            )}
          </>
        )}
      </div>

      {connected && schemas && schemas.length > 0 && (
        <div className="shrink-0 border-t border-black/30 p-2">
          <Select
            value={schema ?? schemas[0]?.name ?? ""}
            onChange={(v) => connectionId && setActiveSchema(connectionId, v)}
            options={schemas.map((s) => ({ value: s.name, label: s.name }))}
          />
        </div>
      )}

      <ContextMenu position={menu.position} items={menuItems} onClose={menu.close} />
    </div>
  );
}
