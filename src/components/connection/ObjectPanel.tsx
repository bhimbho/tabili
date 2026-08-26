import { useMemo, useState } from "react";
import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import { useDatabases, useFunctions, useSchemas, useTables, useViews } from "../../hooks/useSchema";
import { commands } from "../../bindings";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useDialogsStore } from "../../stores/dialogsStore";
import { useServerInfo } from "../../hooks/useConnections";
import { ContextMenu, useContextMenu, type MenuEntry } from "../ui/ContextMenu";
import { Select } from "../ui/Select";
import { DialogCloseButton } from "../ui/DialogCloseButton";
import { friendlyError } from "../../lib/errors";
import * as Dialog from "@radix-ui/react-dialog";
import { ChevronIcon, DatabaseIcon, FunctionIcon, TableIcon, ViewIcon } from "../ui/icons";
import { HistoryPanel, QueriesPanel } from "./HistoryPanel";
import { TableActionsDialog } from "./TableActionsDialog";
import { CreateTableDialog } from "../schema-editor/CreateTableDialog";

type PanelTab = "items" | "queries" | "history";

const TABS: { key: PanelTab; label: string }[] = [
  { key: "items", label: "Items" },
  { key: "queries", label: "Queries" },
  { key: "history", label: "History" },
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
        className="flex w-full items-center gap-1 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-(--text-faint) transition-colors hover:text-(--text-muted)"
      >
        <ChevronIcon className={clsx("h-2.5 w-2.5 transition-transform", open && "rotate-90")} />
        {title}
        <span className="ml-auto font-normal text-(--text-faint)">{count}</span>
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
  const closeTabsFor = useTabsStore((s) => s.closeTabsForConnection);
  const queryClient = useQueryClient();
  const dbPickerOpen = useDialogsStore((s) => s.dialog === "db-picker");
  const setDbPickerOpen = useDialogsStore((s) => (open: boolean) =>
    open ? s.open("db-picker") : s.close(),
  );

  const [tab, setTab] = useState<PanelTab>("items");
  const [search, setSearch] = useState("");
  const [menuTable, setMenuTable] = useState<string | null>(null);
  const [tableAction, setTableAction] = useState<"truncate" | "drop" | null>(null);
  const [tableActionTarget, setTableActionTarget] = useState<string | null>(null);
  const [showNewTable, setShowNewTable] = useState(false);
  const menu = useContextMenu();

  const connection = connections.find((c) => c.id === connectionId);
  const connected = connection?.isConnected ?? false;
  const schema = (connectionId ? activeSchema[connectionId] : undefined) || undefined;

  const { data: schemas } = useSchemas(connected ? connectionId : null);
  const { data: databases } = useDatabases(connected ? connectionId : null);
  const { data: info } = useServerInfo(connected ? connectionId : null);
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  // Database picker dialog state
  const [dbSearch, setDbSearch] = useState("");
  const [selectedDb, setSelectedDb] = useState<string | null>(null);
  const [dbAction, setDbAction] = useState<"create" | "drop" | null>(null);
  const [showNewDbForm, setShowNewDbForm] = useState(false);
  const [newDbName, setNewDbName] = useState("");

  async function switchDatabase(name: string): Promise<boolean> {
    if (!connectionId || name === info?.database) return false;
    setSwitching(true);
    setSwitchError(null);
    const result = await commands.switchDatabase(connectionId, name);
    setSwitching(false);
    if (result.status === "error") {
      setSwitchError(friendlyError(result.error.message));
      return false;
    }
    closeTabsFor(connectionId);
    setActiveSchema(connectionId, "");
    for (const key of ["server-info", "schemas", "tables", "views", "rows", "columns"]) {
      queryClient.invalidateQueries({ queryKey: [key, connectionId] });
    }
    return true;
  }

  async function createDatabase() {
    if (!connectionId) return;
    const trimmed = newDbName.trim();
    if (!trimmed) {
      setSwitchError("Enter a database name first.");
      return;
    }
    setDbAction("create");
    setSwitchError(null);
    const result = await commands.createDatabase(connectionId, trimmed);
    setDbAction(null);
    if (result.status === "error") {
      setSwitchError(friendlyError(result.error.message));
      return;
    }
    setNewDbName("");
    setShowNewDbForm(false);
    await queryClient.invalidateQueries({ queryKey: ["databases", connectionId] });
  }

  async function dropDatabase(name: string) {
    if (!connectionId || !name) return;
    if (databases && databases.length <= 1) {
      setSwitchError("At least one database must remain in the connection.");
      return;
    }
    setDbAction("drop");
    setSwitchError(null);
    const result = await commands.dropDatabase(connectionId, name);
    setDbAction(null);
    if (result.status === "error") {
      setSwitchError(friendlyError(result.error.message));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ["databases", connectionId] });
    await queryClient.invalidateQueries({ queryKey: ["server-info", connectionId] });
    if (databases && databases.length > 1) {
      const next = databases.find((db) => db.name !== name)?.name ?? "";
      if (next) {
        await switchDatabase(next);
      }
    }
  }

  const { data: tables, isLoading, error } = useTables(connected ? connectionId : null, schema);
  const { data: views } = useViews(connected ? connectionId : null, schema);
  const { data: functions } = useFunctions(connected ? connectionId : null, schema);

  const needle = search.trim().toLowerCase();
  const match = (n: string) => !needle || n.toLowerCase().includes(needle);
  const shownTables = useMemo(() => (tables ?? []).filter((t) => match(t.name)), [tables, needle]);
  const shownViews = useMemo(() => (views ?? []).filter((v) => match(v.name)), [views, needle]);
  const shownFunctions = useMemo(
    () => (functions ?? []).filter((f) => match(f.name)),
    [functions, needle],
  );

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
      label: "Truncate…",
      onSelect: () => {
        setTableActionTarget(menuTable);
        setTableAction("truncate");
      },
    },
    {
      label: "Drop…",
      onSelect: () => {
        setTableActionTarget(menuTable);
        setTableAction("drop");
      },
    },
    null,
    {
      label: "Refresh",
      onSelect: () => {
        queryClient.invalidateQueries({ queryKey: ["tables", connectionId] });
        queryClient.invalidateQueries({ queryKey: ["views", connectionId] });
      },
    },
  ];

  const dbNeedle = dbSearch.trim().toLowerCase();
  const shownDatabases = useMemo(
    () => (databases ?? []).filter((d) => !dbNeedle || d.name.toLowerCase().includes(dbNeedle)),
    [databases, dbNeedle],
  );

  if (!connection) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-xs text-(--text-faint)">
        Select a connection on the left, or add one with +
      </div>
    );
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex shrink-0 items-stretch gap-1 px-2 pt-1.5 pb-5">
        <button
          title="Select database"
          onClick={() => {
            setDbPickerOpen(true);
            setDbSearch("");
            setSelectedDb(info?.database ?? null);
            setSwitchError(null);
            setShowNewDbForm(false);
          }}
          className="flex flex-1 items-center justify-center rounded-md p-1 text-(--text-faint) transition-colors hover:bg-(--hover) hover:text-(--text-muted)"
        >
          <DatabaseIcon className="h-4 w-4" />
        </button>
        <button
          onClick={() => {
            if (!connectionId) return;
            openTab({
              id: `${connectionId}:sql`,
              connectionId,
              title: "SQL",
              kind: "query",
              schema: null,
            });
          }}
          className="flex flex-1 items-center justify-center rounded-md px-2 py-1 text-xs font-semibold text-(--text-faint) transition-colors hover:bg-(--hover) hover:text-(--text-muted)"
        >
          SQL
        </button>
        <button
          title="New table"
          onClick={() => setShowNewTable(true)}
          className="flex flex-1 items-center justify-center rounded-md px-2 py-1 text-xs font-semibold text-(--text-faint) transition-colors hover:bg-(--hover) hover:text-(--text-muted)"
        >
          + Table
        </button>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 px-2 pb-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={clsx(
              "rounded-md px-2 py-0.5 text-xs font-medium transition-colors",
              tab === t.key ? "bg-(--active) text-(--text)" : "text-(--text-faint) hover:text-(--text-muted)",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="shrink-0 px-2 pb-2">
          <div className="relative">
            <svg
              className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--text-faint)"
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
              placeholder={tab === "items" ? "Search for item…" : `Search ${tab}…`}
              className="w-full rounded-md border border-(--border) bg-(--surface-sunken) py-1 pl-7 pr-6 text-xs text-(--text) outline-none transition-colors placeholder:text-(--text-faint) focus:border-(--border-strong)"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-(--text-faint) hover:text-(--text-muted)"
              >
                ×
              </button>
            )}
          </div>
        </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1">
        {tab === "history" && <HistoryPanel search={search} />}
        {tab === "queries" && <QueriesPanel search={search} />}

        {tab === "items" && !connected && (
          <p className="px-3 py-2 text-xs text-(--text-faint)">Not connected. Click its icon to connect.</p>
        )}
        {tab === "items" && connected && isLoading && <p className="px-3 py-2 text-xs text-(--text-faint)">Loading…</p>}
        {tab === "items" && connected && error && (
          <p className="px-3 py-2 text-xs text-(--danger)">{friendlyError(error)}</p>
        )}

        {tab === "items" && connected && !isLoading && !error && (
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
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 pl-5 text-left text-xs text-(--text-muted) transition-colors hover:bg-(--hover) hover:text-(--text)"
                >
                  <TableIcon className="h-3.5 w-3.5 shrink-0 text-(--text-faint)" />
                  <span className="truncate">{t.name}</span>
                </button>
              ))}
              {shownTables.length === 0 && (
                <p className="px-2 py-1 pl-5 text-xs text-(--text-faint)">
                  {needle ? "No matches." : "No tables."}
                </p>
              )}
            </Group>

            {shownFunctions.length > 0 && (
              <Group title="Functions" count={shownFunctions.length}>
                {shownFunctions.map((f) => (
                  <div
                    key={`${f.name}(${f.arguments})`}
                    title={`${f.name}(${f.arguments}) → ${f.returns}`}
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 pl-5 text-left text-xs text-(--text-muted)"
                  >
                    <FunctionIcon className="h-3.5 w-3.5 shrink-0 text-(--text-faint)" />
                    <span className="truncate">{f.name}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-(--text-faint)">
                      {f.kind === "procedure" ? "proc" : "fn"}
                    </span>
                  </div>
                ))}
              </Group>
            )}

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
                    className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 pl-5 text-left text-xs text-(--text-muted) transition-colors hover:bg-(--hover) hover:text-(--text)"
                  >
                    <ViewIcon className="h-3.5 w-3.5 shrink-0 text-(--text-faint)" />
                    <span className="truncate">{v.name}</span>
                  </button>
                ))}
              </Group>
            )}
          </>
        )}
      </div>

      {tab === "items" && connected && (
        <div className="shrink-0 space-y-1.5 border-t border-(--border) p-2">
          {schemas && schemas.length > 0 && (
            <label className="block">
              <span className="mb-0.5 block text-[10px] uppercase tracking-wide text-(--text-faint)">
                Schema
              </span>
              <Select
                size="sm"
                value={schema || schemas[0]?.name || ""}
                onChange={(v) => connectionId && setActiveSchema(connectionId, v)}
                options={schemas.map((s) => ({ value: s.name, label: s.name }))}
              />
            </label>
          )}
        </div>
      )}

      <Dialog.Root open={dbPickerOpen} onOpenChange={setDbPickerOpen}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 bg-(--bg)/50 backdrop-blur-[2px]" />
          <Dialog.Content className="fixed left-1/2 top-1/2 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-(--border) bg-(--surface-raised) p-4 shadow-xl shadow-black/40 focus:outline-none">
            <DialogCloseButton onClose={() => setDbPickerOpen(false)} />
            <Dialog.Title className="text-sm font-semibold text-(--text)">Select Database</Dialog.Title>

            <div className="mt-3">
              <div className="relative">
                <svg
                  className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-(--text-faint)"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  autoFocus
                  value={dbSearch}
                  onChange={(e) => setDbSearch(e.target.value)}
                  placeholder="Search for database…"
                  className="w-full rounded-md border border-(--border) bg-(--surface-sunken) py-1.5 pl-7 pr-6 text-xs text-(--text) outline-none transition-colors placeholder:text-(--text-faint) focus:border-(--border-strong)"
                />
                {dbSearch && (
                  <button
                    onClick={() => setDbSearch("")}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded px-1 text-(--text-faint) hover:text-(--text-muted)"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {showNewDbForm && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  autoFocus
                  value={newDbName}
                  onChange={(e) => setNewDbName(e.target.value)}
                  placeholder="Database name"
                  className="min-w-0 flex-1 rounded-md border border-(--border) bg-(--surface-sunken) px-2 py-1.5 text-xs text-(--text) outline-none placeholder:text-(--text-faint) focus:border-(--accent)"
                />
                <button
                  onClick={createDatabase}
                  disabled={dbAction === "create" || !newDbName.trim()}
                  className="rounded-md bg-(--accent) px-3 py-1.5 text-xs font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {dbAction === "create" ? "Creating…" : "Create"}
                </button>
                <button
                  onClick={() => {
                    setShowNewDbForm(false);
                    setNewDbName("");
                  }}
                  className="rounded-md px-2 py-1.5 text-xs text-(--text-muted) transition-colors hover:text-(--text)"
                >
                  Cancel
                </button>
              </div>
            )}

            <div className="mt-3 max-h-[240px] overflow-y-auto rounded-md border border-(--border) bg-(--surface-sunken)">
              {shownDatabases.length === 0 && (
                <p className="px-3 py-2 text-xs text-(--text-faint)">No databases found.</p>
              )}
              {shownDatabases.map((db) => {
                const active = db.name === info?.database;
                return (
                  <button
                    key={db.name}
                    onClick={() => setSelectedDb(db.name)}
                    className={clsx(
                      "flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors",
                      selectedDb === db.name
                        ? "bg-(--accent)/20 text-(--accent)"
                        : "text-(--text-muted) hover:bg-(--hover)",
                    )}
                  >
                    <DatabaseIcon className="h-3.5 w-3.5 shrink-0 text-(--text-faint)" />
                    <span className="truncate">{db.name}</span>
                    {active && (
                      <span className="ml-auto shrink-0 rounded bg-(--active) px-1.5 py-0.5 text-[10px] text-(--text-muted)">
                        active
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {switchError && (
              <p className="mt-2 rounded-md border border-(--danger)/50 bg-(--danger)/10 px-2 py-1.5 text-[11px] text-(--danger)">
                {switchError}
              </p>
            )}

            <div className="mt-4 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    if (!selectedDb || selectedDb === info?.database) return;
                    dropDatabase(selectedDb);
                  }}
                  disabled={dbAction === "drop" || !selectedDb || selectedDb === info?.database || (databases?.length ?? 0) <= 1}
                  className="rounded-md bg-(--danger) px-3 py-1.5 text-xs font-medium text-(--accent-text) transition-colors hover:bg-(--danger)/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {dbAction === "drop" ? "Dropping…" : "Drop"}
                </button>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDbPickerOpen(false)}
                  className="rounded-md px-3 py-1.5 text-xs text-(--text-muted) transition-colors hover:text-(--text)"
                >
                  Cancel
                </button>
                {!showNewDbForm && (
                  <button
                    onClick={() => {
                      setShowNewDbForm(true);
                      setNewDbName("");
                    }}
                    className="rounded-md bg-(--active) px-3 py-1.5 text-xs font-medium text-(--text) transition-colors hover:bg-(--hover)"
                  >
                    New…
                  </button>
                )}
                <button
                  onClick={async () => {
                    if (selectedDb) {
                      const ok = await switchDatabase(selectedDb);
                      if (ok) setDbPickerOpen(false);
                    }
                  }}
                  disabled={!selectedDb || selectedDb === info?.database || switching}
                  className="rounded-md bg-(--accent) px-4 py-1.5 text-xs font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {switching ? "Switching…" : "Open"}
                </button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <ContextMenu position={menu.position} items={menuItems} onClose={menu.close} />

      {connectionId && (
        <TableActionsDialog
          connectionId={connectionId}
          schema={schema ?? null}
          table={tableAction ? tableActionTarget : null}
          action={tableAction}
          onClose={() => setTableAction(null)}
        />
      )}

      {connectionId && (
        <CreateTableDialog
          connectionId={connectionId}
          schema={schema ?? null}
          open={showNewTable}
          onOpenChange={setShowNewTable}
        />
      )}
    </div>
  );
}
