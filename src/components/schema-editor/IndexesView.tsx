import { useState } from "react";
import { useColumns, useIndexes } from "../../hooks/useSchema";
import { DataTable, Empty, Panel, PanelState } from "./panels";
import { IndexDialog } from "./IndexDialog";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { commands } from "../../bindings";
import { friendlyError } from "../../lib/errors";
import { useQueryClient } from "@tanstack/react-query";

export function IndexesView({ connectionId, table, schema }: { connectionId: string; table: string; schema: string | null }) {
  const queryClient = useQueryClient();
  const { data: indexes, isLoading, error } = useIndexes(connectionId, table, schema ?? undefined);
  const { data: columns } = useColumns(connectionId, table, schema ?? undefined);
  const [createOpen, setCreateOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);

  if (isLoading || error) {
    return (
      <Panel>
        <PanelState loading={isLoading} error={error} />
      </Panel>
    );
  }

  async function handleDrop() {
    if (!dropTarget) return;
    setBusy(true);
    setDropError(null);
    const result = await commands.previewDropIndex(connectionId, schema, table, dropTarget);
    if (result.status === "error") {
      setDropError(friendlyError(result.error.message));
      setBusy(false);
      return;
    }
    const exec = await commands.executeDdl(connectionId, result.data);
    setBusy(false);
    if (exec.status === "error") {
      setDropError(friendlyError(exec.error.message));
      return;
    }
    setDropTarget(null);
    queryClient.invalidateQueries({ queryKey: ["indexes", connectionId, schema, table] });
  }

  return (
    <Panel>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-faint)">Indexes</h3>
        <button
          onClick={() => setCreateOpen(true)}
          className="rounded-md px-2 py-1 text-xs font-medium text-(--text-muted) transition-colors hover:bg-(--active) hover:text-(--text)"
        >
          + New index
        </button>
      </div>

      {indexes && indexes.length > 0 ? (
        <DataTable head={["Name", "Columns", "Unique", ""]}>
          {indexes.map((idx) => (
            <tr key={idx.name} className="group text-(--text-muted)">
              <td className="whitespace-nowrap px-3 py-1.5 font-medium">{idx.name}</td>
              <td className="px-3 py-1.5 font-mono text-(--text-muted)">{idx.columns.join(", ")}</td>
              <td className="px-3 py-1.5 text-(--text-faint)">{idx.isUnique ? "YES" : "NO"}</td>
              <td className="w-8 px-3 py-1.5 text-right">
                <button
                  onClick={() => setDropTarget(idx.name)}
                  title="Drop index"
                  className="rounded px-1 text-(--text-faint) opacity-0 transition-opacity hover:text-(--danger) group-hover:opacity-100"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <Empty>No indexes on this table.</Empty>
      )}

      <IndexDialog
        connectionId={connectionId}
        table={table}
        schema={schema}
        open={createOpen}
        onOpenChange={setCreateOpen}
        columns={(columns ?? []).map((c) => c.name)}
      />

      <ConfirmDialog
        open={dropTarget !== null}
        title="Drop Index"
        description={`This permanently removes the "${dropTarget}" index. Data is unchanged.`}
        confirmLabel={busy ? "Dropping…" : "Drop Index"}
        cancelLabel="Cancel"
        danger
        onConfirm={handleDrop}
        onCancel={() => setDropTarget(null)}
      />

      {dropError && (
        <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/50 px-3 py-2 text-xs text-red-300">
          {dropError}
        </div>
      )}
    </Panel>
  );
}
