import { useIndexes } from "../../hooks/useSchema";
import { DataTable, Empty, Panel, PanelState } from "./panels";

export function IndexesView({ connectionId, table }: { connectionId: string; table: string }) {
  const { data: indexes, isLoading, error } = useIndexes(connectionId, table);

  if (isLoading || error) {
    return (
      <Panel>
        <PanelState loading={isLoading} error={error} />
      </Panel>
    );
  }

  return (
    <Panel>
      {indexes && indexes.length > 0 ? (
        <DataTable head={["Name", "Columns", "Unique"]}>
          {indexes.map((idx) => (
            <tr key={idx.name} className="text-neutral-300">
              <td className="whitespace-nowrap px-3 py-1.5 font-medium">{idx.name}</td>
              <td className="px-3 py-1.5 font-mono text-neutral-400">{idx.columns.join(", ")}</td>
              <td className="px-3 py-1.5 text-neutral-500">{idx.isUnique ? "YES" : "NO"}</td>
            </tr>
          ))}
        </DataTable>
      ) : (
        <Empty>No indexes on this table.</Empty>
      )}
    </Panel>
  );
}
