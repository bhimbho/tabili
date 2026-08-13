import { useEffect, useMemo, useState } from "react";
import clsx from "clsx";
import { DataGrid, type FkMap } from "./DataGrid";
import { RowDetailsPanel } from "./RowDetailsPanel";
import { GridToolbar } from "./GridToolbar";
import { PendingChangesDialog } from "./PendingChangesDialog";
import { FilterBar, toColumnFilters, type DraftFilter } from "./FilterBar";
import { StructureView } from "../schema-editor/StructureView";
import { IndexesView } from "../schema-editor/IndexesView";
import { TriggersView } from "../schema-editor/TriggersView";
import { DdlView } from "../schema-editor/DdlView";
import { useColumns, useForeignKeys } from "../../hooks/useSchema";
import { useTableRows, type TableQuery } from "../../hooks/useTableData";
import { useChangesStore } from "../../stores/changesStore";
import { useTabsStore } from "../../stores/tabsStore";
import type { DbValue } from "../../bindings";
import { useConsoleStore } from "../../stores/consoleStore";
import { friendlyError } from "../../lib/errors";

interface TableViewProps {
  connectionId: string;
  table: string;
  schema: string | null;
  seedFilter?: { column: string; value: string };
}

const TABS = ["data", "structure", "indexes", "triggers", "ddl"] as const;
export type TableTab = (typeof TABS)[number];

function TabStrip({ tab, onChange }: { tab: TableTab; onChange: (t: TableTab) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-black/25 p-0.5">
      {TABS.map((t) => (
        <button
          key={t}
          onClick={() => onChange(t)}
          className={clsx(
            "rounded px-2.5 py-0.5 text-xs font-medium capitalize transition-colors",
            tab === t ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200",
          )}
        >
          {t === "ddl" ? "DDL" : t}
        </button>
      ))}
    </div>
  );
}

export function TableView({ connectionId, table, schema, seedFilter }: TableViewProps) {
  const [tab, setTab] = useState<TableTab>("data");
  // A tab opened by following a reference starts filtered to the referenced row.
  const [drafts, setDrafts] = useState<DraftFilter[]>(() =>
    seedFilter
      ? [{ column: seedFilter.column, operator: "Equals", value: seedFilter.value, enabled: true }]
      : [],
  );
  const [query, setQuery] = useState<TableQuery>({ filters: [], orderBy: null, orderDesc: false });
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [activeRow, setActiveRow] = useState<Record<string, DbValue> | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [addColumnOpen, setAddColumnOpen] = useState(false);

  const { data: columnInfos, error: columnsError } = useColumns(connectionId, table, schema ?? undefined);
  const { data: rowPage, isLoading, error, isFetching } = useTableRows(connectionId, table, schema, query);
  const addInsert = useChangesStore((s) => s.addInsert);

  const { data: fks } = useForeignKeys(connectionId, table, schema ?? undefined);
  const openTab = useTabsStore((s) => s.openTab);

  const hasPk = (columnInfos ?? []).some((c) => c.isPrimaryKey);

  // Single-column references only: composite keys have no unambiguous single
  // cell to hang the jump affordance off.
  const foreignKeys = useMemo<FkMap>(() => {
    const map: FkMap = {};
    for (const fk of fks ?? []) {
      if (fk.columns.length === 1 && fk.referencedColumns.length === 1) {
        map[fk.columns[0]] = { table: fk.referencedTable, column: fk.referencedColumns[0] };
      }
    }
    return map;
  }, [fks]);

  function followForeignKey(target: { table: string; column: string }, value: DbValue) {
    const raw =
      value.type === "Int" || value.type === "Float" || value.type === "Bool"
        ? String(value.value)
        : value.type === "Text" ||
            value.type === "Decimal" ||
            value.type === "DateTime" ||
            value.type === "Uuid"
          ? value.value
          : "";
    if (!raw) return;
    openTab({
      id: `${connectionId}:${schema ?? ""}:${target.table}:${target.column}=${raw}`,
      connectionId,
      title: target.table,
      kind: "table",
      schema,
      seedFilter: { column: target.column, value: raw },
    });
  }

  const generatedSql = useMemo(() => {
    const where = drafts
      .filter((d) => d.enabled && d.column)
      .map((d) => {
        if (d.operator === "IsNull") return `${d.column} IS NULL`;
        if (d.operator === "IsNotNull") return `${d.column} IS NOT NULL`;
        const sym: Record<string, string> = {
          Equals: "=", NotEquals: "<>", GreaterThan: ">", LessThan: "<",
          GreaterOrEqual: ">=", LessOrEqual: "<=",
        };
        if (d.operator in sym) return `${d.column} ${sym[d.operator]} '${d.value}'`;
        const pat =
          d.operator === "Contains" ? `%${d.value}%`
          : d.operator === "StartsWith" ? `${d.value}%`
          : `%${d.value}`;
        return `${d.column} LIKE '${pat}'`;
      });
    const order = query.orderBy ? ` ORDER BY ${query.orderBy} ${query.orderDesc ? "DESC" : "ASC"}` : "";
    return `SELECT * FROM ${table}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}${order} LIMIT 500;`;
  }, [drafts, query.orderBy, query.orderDesc, table]);

  // Apply the seeded filter once columns are known so the value is typed correctly.
  useEffect(() => {
    if (!seedFilter || !columnInfos) return;
    setQuery((q) =>
      q.filters.length > 0
        ? q
        : { ...q, filters: toColumnFilters(drafts, columnInfos) },
    );
  }, [seedFilter, columnInfos]); // eslint-disable-line react-hooks/exhaustive-deps

  function applyFilters() {
    setQuery((q) => ({ ...q, filters: toColumnFilters(drafts, columnInfos ?? []) }));
  }

  // Applying one filter disables the rest, so the row you clicked is what you get.
  function applyOnly(index: number) {
    const next = drafts.map((d, i) => ({ ...d, enabled: i === index }));
    setDrafts(next);
    setQuery((q) => ({ ...q, filters: toColumnFilters(next, columnInfos ?? []) }));
  }

  function toggleSort(column: string) {
    setQuery((q) =>
      q.orderBy === column
        ? { ...q, orderDesc: !q.orderDesc }
        : { ...q, orderBy: column, orderDesc: false },
    );
  }

  return (
    <div className="flex h-full flex-col">
      <GridToolbar
        tabStrip={<TabStrip tab={tab} onChange={setTab} />}
        tab={tab}
        hasPk={hasPk}
        columnsError={columnsError ? (columnsError as Error).message : null}
        rowCount={rowPage?.rows.length ?? 0}
        hasMore={rowPage?.hasMore ?? false}
        busy={isFetching}
        onAddRow={() => addInsert({ connectionId, table, schema }, crypto.randomUUID())}
        onAddColumn={() => {
          setTab("structure");
          setAddColumnOpen(true);
        }}
        onReviewChanges={() => setReviewOpen(true)}
        detailsOpen={detailsOpen}
        onToggleDetails={() => setDetailsOpen((d) => !d)}
      />

      {tab === "data" && (
        <FilterBar
          columns={columnInfos ?? []}
          drafts={drafts}
          onChange={setDrafts}
          onApply={applyFilters}
          onApplyOne={applyOnly}
          generatedSql={generatedSql}
        />
      )}

      <div className="min-h-0 flex-1">
        {tab === "structure" && (
          <StructureView
            connectionId={connectionId}
            table={table}
            schema={schema}
            addOpen={addColumnOpen}
            onAddOpenChange={setAddColumnOpen}
          />
        )}
        {tab === "indexes" && <IndexesView connectionId={connectionId} table={table} schema={schema} />}
        {tab === "triggers" && <TriggersView connectionId={connectionId} table={table} schema={schema} />}
        {tab === "ddl" && <DdlView connectionId={connectionId} table={table} schema={schema} />}
        {tab === "data" && (
          <>
            {isLoading && (
              <div className="flex h-full items-center justify-center text-sm text-neutral-500">
                Loading rows…
              </div>
            )}
            {error && (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                <p className="text-sm text-red-400">{friendlyError(error)}</p>
                <button
                  onClick={() => useConsoleStore.getState().setOpen(true)}
                  className="text-xs text-neutral-500 underline-offset-2 hover:underline"
                >
                  Show details in console
                </button>
              </div>
            )}
            {rowPage && !error && (
              <div className="flex h-full">
                <div className="min-w-0 flex-1">
                  <DataGrid
                    connectionId={connectionId}
                    table={table}
                    schema={schema}
                    columns={rowPage.columns}
                    rows={rowPage.rows}
                    columnInfos={columnInfos ?? []}
                    sortColumn={query.orderBy}
                    sortDesc={query.orderDesc}
                    onToggleSort={toggleSort}
                    foreignKeys={foreignKeys}
                    onFollowForeignKey={followForeignKey}
                    onActiveRowChange={setActiveRow}
                  />
                </div>
                {detailsOpen && (
                  <RowDetailsPanel
                    row={activeRow}
                    columns={rowPage.columns}
                    columnInfos={columnInfos ?? []}
                    foreignKeys={foreignKeys}
                    onFollowForeignKey={followForeignKey}
                    onClose={() => setDetailsOpen(false)}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>

      <PendingChangesDialog open={reviewOpen} onOpenChange={setReviewOpen} />
    </div>
  );
}
