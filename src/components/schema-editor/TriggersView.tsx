import { useTriggers } from "../../hooks/useSchema";
import { DataTable, Empty, Panel, PanelState } from "./panels";

export function TriggersView({ connectionId, table }: { connectionId: string; table: string }) {
  const { data: triggers, isLoading, error } = useTriggers(connectionId, table);

  if (isLoading || error) {
    return (
      <Panel>
        <PanelState loading={isLoading} error={error} />
      </Panel>
    );
  }

  return (
    <Panel>
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
    </Panel>
  );
}
