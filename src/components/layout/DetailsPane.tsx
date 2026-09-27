import type { DbValue } from "../../bindings";
import { RowDetailsPanel } from "../grid/RowDetailsPanel";
import { Resizer } from "../ui/Resizer";
import { useDetailsStore } from "../../stores/detailsStore";
import { useLayoutStore } from "../../stores/layoutStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useConnectionsStore } from "../../stores/connectionsStore";

/** Text form of a value for use as a filter operand when following a reference. */
function operand(value: DbValue): string {
  switch (value.type) {
    case "Int":
    case "Float":
    case "Bool":
      return String(value.value);
    case "Text":
    case "Decimal":
    case "DateTime":
    case "Uuid":
      return value.value;
    default:
      return "";
  }
}

/**
 * Sits at the window edge spanning the full height of the workspace, rather than
 * inside the table view, so it stays put as you move between tabs.
 */
export function DetailsPane() {
  const { context, row } = useDetailsStore();
  const { detailsWidth, detailsVisible, setDetailsWidth, setDetailsVisible } = useLayoutStore();
  const openTab = useTabsStore((s) => s.openTab);
  const activeConnectionId = useConnectionsStore((s) => s.activeConnectionId);

  // The context outlives the table view that published it, so after switching
  // connection this pane kept showing — and offered edits against — a row from
  // the connection we just left.
  if (!detailsVisible || !context || context.connectionId !== activeConnectionId) return null;

  function followForeignKey(target: { table: string; column: string }, value: DbValue) {
    if (!context) return;
    const raw = operand(value);
    if (!raw) return;
    openTab({
      id: `${context.connectionId}:${context.schema ?? ""}:${target.table}:${target.column}=${raw}`,
      connectionId: context.connectionId,
      title: target.table,
      kind: "table",
      schema: context.schema,
      seedFilter: { column: target.column, value: raw },
    });
  }

  return (
    <>
      <Resizer
        width={detailsWidth}
        onResize={setDetailsWidth}
        side="right"
        min={220}
        max={560}
      />
      <RowDetailsPanel
        width={detailsWidth}
        row={row}
        columns={context.columns}
        columnInfos={context.columnInfos}
        foreignKeys={context.foreignKeys}
        onFollowForeignKey={followForeignKey}
        onClose={() => setDetailsVisible(false)}
        edit={{
          connectionId: context.connectionId,
          schema: context.schema,
          table: context.table,
        }}
      />
    </>
  );
}
