import { useState } from "react";
import { useColumns, useForeignKeys } from "../../hooks/useSchema";
import { KeyIcon, PlusIcon } from "../ui/icons";
import { ContextMenu, useContextMenu, type MenuEntry } from "../ui/ContextMenu";
import { AddColumnDialog } from "./AddColumnDialog";
import { DropColumnDialog } from "./DropColumnDialog";
import { EditColumnDialog } from "./EditColumnDialog";
import type { ColumnInfo } from "../../bindings";
import { DataTable, Empty, Panel, PanelState } from "./panels";

interface StructureViewProps {
  connectionId: string;
  table: string;
  schema: string | null;
  /** Opened from the toolbar's "+ Column" action as well as the in-panel button. */
  addOpen: boolean;
  onAddOpenChange: (open: boolean) => void;
}

export function StructureView({ connectionId, table, schema, addOpen, onAddOpenChange }: StructureViewProps) {
  const { data: columns, isLoading, error } = useColumns(connectionId, table, schema ?? undefined);
  const { data: foreignKeys } = useForeignKeys(connectionId, table, schema ?? undefined);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [menuColumn, setMenuColumn] = useState<ColumnInfo | null>(null);
  const [editTarget, setEditTarget] = useState<ColumnInfo | null>(null);
  const menu = useContextMenu();

  const menuItems: MenuEntry[] = [
    {
      label: "Copy column name",
      onSelect: () => menuColumn && navigator.clipboard.writeText(menuColumn.name),
    },
    null,
    { label: "Edit column…", onSelect: () => menuColumn && setEditTarget(menuColumn) },
    { label: "Add column…", onSelect: () => onAddOpenChange(true) },
    {
      label: "Drop column…",
      danger: true,
      onSelect: () => menuColumn && setDropTarget(menuColumn.name),
    },
  ];

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
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Columns</h3>
        <button
          onClick={() => onAddOpenChange(true)}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
        >
          <PlusIcon className="h-3 w-3" />
          Add Column
        </button>
      </div>

      <DataTable head={["", "Name", "Type", "Nullable", "Default", ""]}>
        {columns?.map((col) => (
          <tr
            key={col.name}
            className="group text-neutral-300"
            onContextMenu={(e) => {
              setMenuColumn(col);
              menu.open(e);
            }}
          >
            <td className="w-6 px-3 py-1.5">
              {col.isPrimaryKey && (
                <span title="Primary key">
                  <KeyIcon className="h-3 w-3 text-amber-500" />
                </span>
              )}
            </td>
            <td className="whitespace-nowrap px-3 py-1.5 font-medium">{col.name}</td>
            <td className="whitespace-nowrap px-3 py-1.5 font-mono text-neutral-400">{col.dataType}</td>
            <td className="px-3 py-1.5 text-neutral-500">{col.nullable ? "YES" : "NO"}</td>
            <td className="max-w-[220px] truncate px-3 py-1.5 font-mono text-neutral-500">
              {col.defaultValue ?? "—"}
            </td>
            <td className="w-8 px-3 py-1.5 text-right">
              <button
                onClick={() => setDropTarget(col.name)}
                title="Drop column"
                className="rounded px-1 text-neutral-600 opacity-0 transition-opacity hover:text-red-400 group-hover:opacity-100"
              >
                ×
              </button>
            </td>
          </tr>
        ))}
      </DataTable>

      <div className="mt-6">
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Foreign Keys
        </h3>
        {foreignKeys && foreignKeys.length > 0 ? (
          <DataTable head={["Name", "Columns", "References"]}>
            {foreignKeys.map((fk) => (
              <tr key={fk.name} className="text-neutral-300">
                <td className="whitespace-nowrap px-3 py-1.5 font-medium">{fk.name}</td>
                <td className="px-3 py-1.5 font-mono text-neutral-400">{fk.columns.join(", ")}</td>
                <td className="px-3 py-1.5 font-mono text-neutral-400">
                  {fk.referencedTable}({fk.referencedColumns.join(", ")})
                </td>
              </tr>
            ))}
          </DataTable>
        ) : (
          <Empty>No foreign keys.</Empty>
        )}
      </div>

      <ContextMenu position={menu.position} items={menuItems} onClose={menu.close} />
      <AddColumnDialog
        connectionId={connectionId}
        table={table}
        schema={schema}
        open={addOpen}
        onOpenChange={onAddOpenChange}
      />
      <DropColumnDialog
        connectionId={connectionId}
        table={table}
        schema={schema}
        column={dropTarget}
        onClose={() => setDropTarget(null)}
      />
      <EditColumnDialog
        connectionId={connectionId}
        table={table}
        schema={schema}
        column={editTarget}
        onClose={() => setEditTarget(null)}
      />
    </Panel>
  );
}
