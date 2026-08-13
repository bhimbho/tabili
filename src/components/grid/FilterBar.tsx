import { useState } from "react";
import type { ColumnInfo, ColumnFilter, DbValue, FilterOperator } from "../../bindings";
import { Select } from "../ui/Select";
import { PlusIcon } from "../ui/icons";

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "Contains", label: "contains" },
  { value: "Equals", label: "equals" },
  { value: "NotEquals", label: "not equals" },
  { value: "StartsWith", label: "begins with" },
  { value: "EndsWith", label: "ends with" },
  { value: "GreaterThan", label: "greater than" },
  { value: "LessThan", label: "less than" },
  { value: "GreaterOrEqual", label: "≥" },
  { value: "LessOrEqual", label: "≤" },
  { value: "IsNull", label: "is null" },
  { value: "IsNotNull", label: "is not null" },
];

const NO_VALUE: FilterOperator[] = ["IsNull", "IsNotNull"];
const TEXT_ONLY: FilterOperator[] = ["Contains", "StartsWith", "EndsWith"];

export interface DraftFilter {
  column: string;
  operator: FilterOperator;
  value: string;
  enabled: boolean;
}

export function newDraft(columns: ColumnInfo[]): DraftFilter {
  return { column: columns[0]?.name ?? "", operator: "Contains", value: "", enabled: true };
}

/** Types the raw input against the column so it binds as the right SQL type. */
function toDbValue(raw: string, column: ColumnInfo | undefined, op: FilterOperator): DbValue | null {
  if (NO_VALUE.includes(op)) return null;
  if (TEXT_ONLY.includes(op)) return { type: "Text", value: raw };

  const t = (column?.dataType ?? "").toLowerCase();
  if (/int|serial/.test(t)) {
    const n = parseInt(raw, 10);
    return Number.isNaN(n) ? { type: "Text", value: raw } : { type: "Int", value: n };
  }
  if (/real|double|float/.test(t)) {
    const n = parseFloat(raw);
    return Number.isNaN(n) ? { type: "Text", value: raw } : { type: "Float", value: n };
  }
  if (/numeric|decimal/.test(t)) return { type: "Decimal", value: raw };
  if (/bool/.test(t)) return { type: "Bool", value: /^(1|t|true|yes)$/i.test(raw.trim()) };
  return { type: "Text", value: raw };
}

export function toColumnFilters(drafts: DraftFilter[], columns: ColumnInfo[]): ColumnFilter[] {
  return drafts
    .filter((d) => d.enabled && d.column && (NO_VALUE.includes(d.operator) || d.value !== ""))
    .map((d) => ({
      column: d.column,
      operator: d.operator,
      value: toDbValue(d.value, columns.find((c) => c.name === d.column), d.operator),
    }));
}

interface FilterBarProps {
  columns: ColumnInfo[];
  drafts: DraftFilter[];
  onChange: (drafts: DraftFilter[]) => void;
  onApply: () => void;
  generatedSql?: string;
}

const iconBtn =
  "flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-neutral-800 text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100";

export function FilterBar({ columns, drafts, onChange, onApply, generatedSql }: FilterBarProps) {
  const [showSql, setShowSql] = useState(false);

  function update(i: number, patch: Partial<DraftFilter>) {
    onChange(drafts.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  function insertAfter(i: number) {
    const next = [...drafts];
    next.splice(i + 1, 0, newDraft(columns));
    onChange(next);
  }

  function removeAt(i: number) {
    const next = drafts.filter((_, idx) => idx !== i);
    onChange(next);
    // Removing the last filter should restore the unfiltered view immediately
    // rather than leaving stale results on screen.
    if (next.length === 0) setTimeout(onApply, 0);
  }

  if (drafts.length === 0) {
    return (
      <div className="shrink-0 border-b border-neutral-800 bg-neutral-900/60 px-3 py-1.5">
        <button
          onClick={() => onChange([newDraft(columns)])}
          disabled={columns.length === 0}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 disabled:opacity-40"
        >
          <PlusIcon className="h-3 w-3" />
          Add filter
        </button>
      </div>
    );
  }

  return (
    <div className="shrink-0 border-b border-neutral-800 bg-neutral-900/60 px-3 py-2">
      {/* One filter per row, stacked, so many filters stay readable. */}
      <div className="space-y-1.5">
        {drafts.map((d, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={d.enabled}
              onChange={(e) => update(i, { enabled: e.target.checked })}
              title={d.enabled ? "Disable this filter" : "Enable this filter"}
              className="h-3.5 w-3.5 shrink-0 accent-indigo-500"
            />
            <div className="w-[150px] shrink-0">
              <Select
                size="sm"
                value={d.column}
                onChange={(v) => update(i, { column: v })}
                options={columns.map((c) => ({ value: c.name, label: c.name }))}
              />
            </div>
            <div className="w-[120px] shrink-0">
              <Select
                size="sm"
                value={d.operator}
                onChange={(v) => update(i, { operator: v as FilterOperator })}
                options={OPERATORS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
            <input
              value={d.value}
              disabled={NO_VALUE.includes(d.operator)}
              onChange={(e) => update(i, { value: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && onApply()}
              placeholder={NO_VALUE.includes(d.operator) ? "—" : "value"}
              className="min-w-0 flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-0.5 text-xs text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-indigo-500 disabled:opacity-40"
            />
            <button onClick={() => removeAt(i)} title="Remove filter" className={iconBtn}>
              −
            </button>
            <button onClick={() => insertAfter(i)} title="Add filter" className={iconBtn}>
              <PlusIcon className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between">
        <button
          onClick={() => setShowSql((s) => !s)}
          className="rounded-md px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
        >
          {showSql ? "Hide SQL" : "SQL"}
        </button>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              onChange([]);
              setTimeout(onApply, 0);
            }}
            className="rounded-md px-2.5 py-0.5 text-xs text-neutral-400 transition-colors hover:text-neutral-200"
          >
            Clear
          </button>
          <button
            onClick={onApply}
            className="rounded-md bg-indigo-600 px-3 py-0.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
          >
            Apply
          </button>
        </div>
      </div>

      {showSql && generatedSql && (
        <pre className="selectable mt-2 overflow-x-auto rounded-md bg-black/30 px-2 py-1.5 font-mono text-[11px] text-neutral-300">
          {generatedSql}
        </pre>
      )}
    </div>
  );
}
