import { useState } from "react";
import clsx from "clsx";
import { DataGrid } from "./DataGrid";
import { GridToolbar } from "./GridToolbar";
import { PendingChangesDialog } from "./PendingChangesDialog";
import { StructureView } from "../schema-editor/StructureView";
import { useColumns } from "../../hooks/useSchema";
import { useTableRows } from "../../hooks/useTableData";
import { useChangesStore } from "../../stores/changesStore";

interface TableViewProps {
  connectionId: string;
  table: string;
}

type Mode = "data" | "structure";

function ModeTabs({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div className="flex items-center gap-0.5 rounded-md bg-black/25 p-0.5">
      {(["data", "structure"] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className={clsx(
            "rounded px-2.5 py-0.5 text-xs font-medium capitalize transition-colors",
            mode === m ? "bg-neutral-700 text-neutral-100" : "text-neutral-400 hover:text-neutral-200",
          )}
        >
          {m}
        </button>
      ))}
    </div>
  );
}

export function TableView({ connectionId, table }: TableViewProps) {
  const [mode, setMode] = useState<Mode>("data");
  const { data: rowPage, isLoading, error } = useTableRows(connectionId, table);
  const { data: columnInfos, error: columnsError } = useColumns(connectionId, table);
  const [reviewOpen, setReviewOpen] = useState(false);
  const addInsert = useChangesStore((s) => s.addInsert);

  const hasPk = (columnInfos ?? []).some((c) => c.isPrimaryKey);

  function handleAddRow() {
    addInsert({ connectionId, table }, crypto.randomUUID());
  }

  return (
    <div className="flex h-full flex-col">
      <GridToolbar
        hasPk={hasPk}
        columnsError={columnsError ? (columnsError as Error).message : null}
        mode={mode}
        onModeChange={setMode}
        modeTabs={<ModeTabs mode={mode} onChange={setMode} />}
        onAddRow={handleAddRow}
        onReviewChanges={() => setReviewOpen(true)}
      />

      <div className="min-h-0 flex-1">
        {mode === "structure" ? (
          <StructureView connectionId={connectionId} table={table} />
        ) : (
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
            {rowPage && (
              <DataGrid
                connectionId={connectionId}
                table={table}
                columns={rowPage.columns}
                rows={rowPage.rows}
                columnInfos={columnInfos ?? []}
              />
            )}
          </>
        )}
      </div>

      <PendingChangesDialog open={reviewOpen} onOpenChange={setReviewOpen} />
    </div>
  );
}
