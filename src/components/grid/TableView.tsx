import { useMemo, useState } from "react";
import clsx from "clsx";
import { DataGrid } from "./DataGrid";
import { GridToolbar } from "./GridToolbar";
import { PendingChangesDialog } from "./PendingChangesDialog";
import { FilterBar, toColumnFilters, type DraftFilter } from "./FilterBar";
import { StructureView } from "../schema-editor/StructureView";
import { IndexesView } from "../schema-editor/IndexesView";
import { TriggersView } from "../schema-editor/TriggersView";
import { DdlView } from "../schema-editor/DdlView";
import { useColumns } from "../../hooks/useSchema";
import { useTableRows, type TableQuery } from "../../hooks/useTableData";
import { useChangesStore } from "../../stores/changesStore";

interface TableViewProps {
  connectionId: string;
  table: string;
  schema: string | null;
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

export function TableView({ connectionId, table, schema }: TableViewProps) {
  const [tab, setTab] = useState<TableTab>("data");
  const [drafts, setDrafts] = useState<DraftFilter[]>([]);
  const [query, setQuery] = useState<TableQuery>({ filters: [], orderBy: null, orderDesc: false });
  const [reviewOpen, setReviewOpen] = useState(false);
  const [addColumnOpen, setAddColumnOpen] = useState(false);

  const { data: columnInfos, error: columnsError } = useColumns(connectionId, table, schema ?? undefined);
  const { data: rowPage, isLoading, error, isFetching } = useTableRows(connectionId, table, schema, query);
  const addInsert = useChangesStore((s) => s.addInsert);

  const hasPk = (columnInfos ?? []).some((c) => c.isPrimaryKey);

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

  function applyFilters() {
    setQuery((q) => ({ ...q, filters: toColumnFilters(drafts, columnInfos ?? []) }));
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
      />

      {tab === "data" && (
        <FilterBar
          columns={columnInfos ?? []}
          drafts={drafts}
          onChange={setDrafts}
          onApply={applyFilters}
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
              <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-400">
                {(error as Error).message}
              </div>
            )}
            {rowPage && !error && (
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
              />
            )}
          </>
        )}
      </div>

      <PendingChangesDialog open={reviewOpen} onOpenChange={setReviewOpen} />
    </div>
  );
}
