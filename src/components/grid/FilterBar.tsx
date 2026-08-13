import { useState } from "react";
import type { ColumnInfo, ColumnFilter, DbValue, FilterOperator } from "../../bindings";
import { Select } from "../ui/Select";
import { PlusIcon } from "../ui/icons";

const OPERATORS: { value: FilterOperator; label: string }[] = [
  { value: "Equals", label: "=" },
  { value: "NotEquals", label: "≠" },
  { value: "Contains", label: "contains" },
  { value: "StartsWith", label: "starts with" },
  { value: "EndsWith", label: "ends with" },
  { value: "GreaterThan", label: ">" },
  { value: "LessThan", label: "<" },
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
    .filter((d) => d.column && (NO_VALUE.includes(d.operator) || d.value !== ""))
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

export function FilterBar({ columns, drafts, onChange, onApply, generatedSql }: FilterBarProps) {
  const [showSql, setShowSql] = useState(false);
  const columnOptions = columns.map((c) => ({ value: c.name, label: c.name }));

  function update(i: number, patch: Partial<DraftFilter>) {
    onChange(drafts.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));
  }

  function add() {
    onChange([
      ...drafts,
      { column: columns[0]?.name ?? "", operator: "Contains" as FilterOperator, value: "" },
    ]);
  }

  return (
    <div className="shrink-0 border-b border-neutral-800 bg-neutral-900/60 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {drafts.map((d, i) => (
          <div key={i} className="flex items-center gap-1 rounded-md border border-neutral-800 bg-neutral-950 p-1">
            <div className="w-[130px]">
              <Select value={d.column} onChange={(v) => update(i, { column: v })} options={columnOptions} />
            </div>
            <div className="w-[110px]">
              <Select
                value={d.operator}
                onChange={(v) => update(i, { operator: v as FilterOperator })}
                options={OPERATORS.map((o) => ({ value: o.value, label: o.label }))}
              />
            </div>
            {!NO_VALUE.includes(d.operator) && (
              <input
                value={d.value}
                onChange={(e) => update(i, { value: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && onApply()}
                placeholder="value"
                className="w-[130px] rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-100 outline-none placeholder:text-neutral-600 focus:border-indigo-500"
              />
            )}
            <button
              onClick={() => onChange(drafts.filter((_, idx) => idx !== i))}
              title="Remove filter"
              className="rounded px-1.5 text-neutral-500 hover:text-red-400"
            >
              ×
            </button>
          </div>
        ))}

        <button
          onClick={add}
          disabled={columns.length === 0}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 disabled:opacity-40"
        >
          <PlusIcon className="h-3 w-3" />
          Filter
        </button>

        {drafts.length > 0 && (
          <>
            <button
              onClick={onApply}
              className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
            >
              Apply
            </button>
            <button
              onClick={() => {
                onChange([]);
                onApply();
              }}
              className="rounded-md px-2 py-1 text-xs text-neutral-400 transition-colors hover:text-neutral-200"
            >
              Clear
            </button>
            {generatedSql && (
              <button
                onClick={() => setShowSql((s) => !s)}
                className="rounded-md px-2 py-1 text-xs text-neutral-500 transition-colors hover:text-neutral-300"
              >
                {showSql ? "Hide SQL" : "View SQL"}
              </button>
            )}
          </>
        )}
      </div>

      {showSql && generatedSql && (
        <pre className="selectable mt-2 overflow-x-auto rounded-md bg-black/30 px-2 py-1.5 font-mono text-xs text-neutral-300">
          {generatedSql}
        </pre>
      )}
    </div>
  );
}
