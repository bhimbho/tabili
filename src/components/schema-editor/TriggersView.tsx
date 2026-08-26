import { useState } from "react";
import { useTriggers } from "../../hooks/useSchema";
import { DataTable, Empty, Panel, PanelState } from "./panels";
import { TriggerDialog } from "./TriggerDialog";

export function TriggersView({ connectionId, table, schema }: { connectionId: string; table: string; schema: string | null }) {
  const { data: triggers, isLoading, error } = useTriggers(connectionId, table, schema ?? undefined);
  const [createOpen, setCreateOpen] = useState(false);

  if (isLoading || error) {
    return (
      <Panel>
        <PanelState loading={isLoading} error={error} />
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Triggers</h3>
        <button
          onClick={() => setCreateOpen(true)}
          className="rounded-md px-2 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
        >
          + New trigger
        </button>
      </div>

      {triggers && triggers.length > 0 ? (
        <DataTable head={["Name", "Timing", "Event", "Definition"]}>
          {triggers.map((t) => (
            <tr key={t.name} className="text-neutral-300 align-top">
              <td className="whitespace-nowrap px-3 py-1.5 font-medium">{t.name}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-neutral-500">{t.timing || "—"}</td>
              <td className="whitespace-nowrap px-3 py-1.5 text-neutral-500">{t.event || "—"}</td>
              <td className="selectable max-w-[420px] px-3 py-1.5 font-mono text-[11px] text-neutral-400">
                <div className="max-h-24 overflow-y-auto whitespace-pre-wrap">{t.statement}</div>
              </td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <Empty>No triggers on this table.</Empty>
      )}

      <TriggerDialog
        connectionId={connectionId}
        table={table}
        schema={schema}
        open={createOpen}
        onOpenChange={setCreateOpen}
      />
    </Panel>
  );
}
