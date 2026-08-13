import { useState, type ReactNode } from "react";
import { useColumns, useForeignKeys, useIndexes } from "../../hooks/useSchema";
import { KeyIcon, PlusIcon } from "../ui/icons";
import { AddColumnDialog } from "./AddColumnDialog";
import { DropColumnDialog } from "./DropColumnDialog";

interface StructureViewProps {
  connectionId: string;
  table: string;
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-neutral-800">
      <table className="w-full text-left text-xs">
        <thead className="bg-neutral-900/60 text-neutral-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/70">{children}</tbody>
      </table>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-neutral-800 px-3 py-3 text-xs text-neutral-600">{children}</p>;
}

export function StructureView({ connectionId, table }: StructureViewProps) {
  const { data: columns, isLoading, error } = useColumns(connectionId, table);
  const { data: indexes } = useIndexes(connectionId, table);
  const { data: foreignKeys } = useForeignKeys(connectionId, table);
  const [addOpen, setAddOpen] = useState(false);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-neutral-500">Loading structure…</div>;
  }
  if (error) {
    return (
      <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-400">
        {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto px-4 py-4">
      <Section
        title="Columns"
        action={
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
          >
            <PlusIcon className="h-3 w-3" />
            Add Column
          </button>
        }
      >
        <Table head={["", "Name", "Type", "Nullable", "Default", ""]}>
          {columns?.map((col) => (
            <tr key={col.name} className="group text-neutral-300">
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
        </Table>
      </Section>

      <Section title="Indexes">
        {indexes && indexes.length > 0 ? (
          <Table head={["Name", "Columns", "Unique"]}>
            {indexes.map((idx) => (
              <tr key={idx.name} className="text-neutral-300">
                <td className="whitespace-nowrap px-3 py-1.5 font-medium">{idx.name}</td>
                <td className="px-3 py-1.5 font-mono text-neutral-400">{idx.columns.join(", ")}</td>
                <td className="px-3 py-1.5 text-neutral-500">{idx.isUnique ? "YES" : "NO"}</td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No indexes.</Empty>
        )}
      </Section>

      <Section title="Foreign Keys">
        {foreignKeys && foreignKeys.length > 0 ? (
          <Table head={["Name", "Columns", "References"]}>
            {foreignKeys.map((fk) => (
              <tr key={fk.name} className="text-neutral-300">
                <td className="whitespace-nowrap px-3 py-1.5 font-medium">{fk.name}</td>
                <td className="px-3 py-1.5 font-mono text-neutral-400">{fk.columns.join(", ")}</td>
                <td className="px-3 py-1.5 font-mono text-neutral-400">
                  {fk.referencedTable}({fk.referencedColumns.join(", ")})
                </td>
              </tr>
            ))}
          </Table>
        ) : (
          <Empty>No foreign keys.</Empty>
        )}
      </Section>

      <AddColumnDialog
        connectionId={connectionId}
        table={table}
        open={addOpen}
        onOpenChange={setAddOpen}
      />
      <DropColumnDialog
        connectionId={connectionId}
        table={table}
        column={dropTarget}
        onClose={() => setDropTarget(null)}
      />
    </div>
  );
}
