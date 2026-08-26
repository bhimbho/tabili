import { useState } from "react";
import { useIndexes, useForeignKeys, useTriggers, useRowCount } from "../../hooks/useSchema";
import { KeyIcon, TableIcon } from "../ui/icons";
import type { ColumnInfo } from "../../bindings";

interface TableDetailsPanelProps {
  connectionId: string;
  schema: string | null;
  table: string;
  columnInfos: ColumnInfo[];
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-1.5 flex items-baseline gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-(--text-faint)">
        {title}
        {count !== undefined && <span className="font-normal text-(--text-faint)">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 py-0.5">
      <span className="shrink-0 text-xs text-(--text-faint)">{label}</span>
      <span className="selectable truncate text-xs text-(--text)" title={value}>
        {value}
      </span>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-(--text-faint)">{children}</p>;
}

/**
 * Shown in place of the row inspector when a table is open but no row is
 * selected — the pane describes the table itself rather than sitting empty.
 */
export function TableDetailsPanel({
  connectionId,
  schema,
  table,
  columnInfos,
}: TableDetailsPanelProps) {
  const [search, setSearch] = useState("");
  const { data: indexes } = useIndexes(connectionId, table, schema ?? undefined);
  const { data: foreignKeys } = useForeignKeys(connectionId, table, schema ?? undefined);
  const { data: triggers } = useTriggers(connectionId, table, schema ?? undefined);
  // A catalog estimate — the table listing doesn't carry one.
  const { data: rowCount } = useRowCount(connectionId, table, schema ?? undefined);

  const primaryKey = columnInfos.filter((c) => c.isPrimaryKey).map((c) => c.name);

  const needle = search.trim().toLowerCase();
  const shownColumns = columnInfos.filter((c) => !needle || c.name.toLowerCase().includes(needle));

  return (
    <>
      <div className="shrink-0 px-3 py-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search for field…"
          className="w-full rounded-md border border-(--border) bg-(--surface-sunken) px-2 py-1 text-xs text-(--text) outline-none transition-colors placeholder:text-(--text-faint) focus:border-(--accent)"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        <div className="mb-3 flex items-center gap-2">
          <TableIcon className="h-4 w-4 shrink-0 text-(--text-faint)" />
          <span className="selectable truncate text-sm font-semibold text-(--text)">{table}</span>
        </div>

        <Section title="Overview">
          {schema && <Stat label="Schema" value={schema} />}
          <Stat label="Columns" value={String(columnInfos.length)} />
          {rowCount != null && <Stat label="Rows (est.)" value={rowCount.toLocaleString()} />}
          <Stat
            label="Primary key"
            value={primaryKey.length > 0 ? primaryKey.join(", ") : "none"}
          />
        </Section>

        <Section title="Columns" count={columnInfos.length}>
          {shownColumns.length === 0 ? (
            <Empty>No matching fields.</Empty>
          ) : (
            <ul className="space-y-0.5">
              {shownColumns.map((c) => (
                <li key={c.name} className="flex items-baseline gap-1.5">
                  {c.isPrimaryKey && <KeyIcon className="h-2.5 w-2.5 shrink-0 text-amber-500" />}
                  <span className="selectable truncate text-xs text-(--text)">{c.name}</span>
                  {!c.nullable && <span className="text-[10px] text-(--text-faint)">not null</span>}
                  <span
                    className="ml-auto shrink-0 truncate font-mono text-[10px] text-(--text-faint)"
                    title={c.dataType}
                  >
                    {c.dataType}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Indexes" count={indexes?.length}>
          {!indexes || indexes.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <ul className="space-y-1">
              {indexes.map((i) => (
                <li key={i.name}>
                  <div className="flex items-baseline gap-1.5">
                    <span className="selectable truncate text-xs text-(--text)">{i.name}</span>
                    {i.isUnique && (
                      <span className="shrink-0 text-[10px] text-(--accent)">unique</span>
                    )}
                  </div>
                  <span className="font-mono text-[10px] text-(--text-faint)">
                    {i.columns.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Foreign keys" count={foreignKeys?.length}>
          {!foreignKeys || foreignKeys.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <ul className="space-y-1">
              {foreignKeys.map((fk) => (
                <li key={fk.name}>
                  <div className="selectable truncate text-xs text-(--text)">
                    {fk.columns.join(", ")}
                  </div>
                  <span className="font-mono text-[10px] text-(--text-faint)">
                    → {fk.referencedTable}.{fk.referencedColumns.join(", ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section title="Triggers" count={triggers?.length}>
          {!triggers || triggers.length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <ul className="space-y-1">
              {triggers.map((t) => (
                <li key={t.name}>
                  <div className="selectable truncate text-xs text-(--text)">{t.name}</div>
                  <span className="font-mono text-[10px] text-(--text-faint)">
                    {t.timing} {t.event}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </>
  );
}
