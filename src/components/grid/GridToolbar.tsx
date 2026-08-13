import type { ReactNode } from "react";
import { useChangesStore } from "../../stores/changesStore";
import { PlusIcon } from "../ui/icons";

interface GridToolbarProps {
  hasPk: boolean;
  /** Non-null when schema introspection failed — the real reason editing is off. */
  columnsError: string | null;
  mode: "data" | "structure";
  onModeChange: (mode: "data" | "structure") => void;
  modeTabs: ReactNode;
  onAddRow: () => void;
  onReviewChanges: () => void;
}

export function GridToolbar({ hasPk, columnsError, mode, modeTabs, onAddRow, onReviewChanges }: GridToolbarProps) {
  const count = useChangesStore((s) => s.count());
  const isData = mode === "data";

  return (
    <div className="flex h-9 shrink-0 items-center justify-between border-b border-neutral-800 bg-neutral-900 px-3">
      <div className="flex min-w-0 items-center gap-2">
        {modeTabs}
        {isData && (
          <button
            onClick={onAddRow}
            disabled={!hasPk}
            title={hasPk ? "Add row" : "Editing needs a primary key"}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <PlusIcon className="h-3 w-3" />
            Add Row
          </button>
        )}
        {isData && columnsError && (
          <span className="truncate text-xs text-red-400" title={columnsError}>
            Schema load failed — {columnsError}
          </span>
        )}
        {isData && !columnsError && !hasPk && (
          <span className="text-xs text-amber-500">No primary key — read-only</span>
        )}
      </div>

      <button
        onClick={onReviewChanges}
        disabled={count === 0}
        className="shrink-0 rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-neutral-800 disabled:text-neutral-500"
      >
        Pending Changes {count > 0 ? count : ""}
      </button>
    </div>
  );
}
