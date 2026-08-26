import { useChangesStore } from "../../stores/changesStore";
import { PlusIcon } from "../ui/icons";

interface GridToolbarProps {
  tab: string;
  hasPk: boolean;
  /** Non-null when schema introspection failed — the real reason editing is off. */
  columnsError: string | null;
  onAddRow: () => void;
  onAddColumn: () => void;
  onReviewChanges: () => void;
}

export function GridToolbar({
  tab,
  hasPk,
  columnsError,
  onAddRow,
  onAddColumn,
  onReviewChanges,
}: GridToolbarProps) {
  const count = useChangesStore((s) => s.count());
  const isData = tab === "data";

  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-(--border) bg-(--surface-sunken) px-3">
      <div className="flex min-w-0 items-center gap-2">
        {isData && (
          <button
            onClick={onAddRow}
            disabled={!hasPk}
            title={hasPk ? "Add row" : "Editing needs a primary key"}
            className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-(--text-muted) transition-colors hover:bg-(--active) hover:text-(--text) disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
          >
            <PlusIcon className="h-3 w-3" />
            Row
          </button>
        )}
        <button
          onClick={onAddColumn}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-(--text-muted) transition-colors hover:bg-(--active) hover:text-(--text)"
        >
          <PlusIcon className="h-3 w-3" />
          Column
        </button>

        {isData && columnsError && (
          <span className="truncate text-xs text-(--danger)" title={columnsError}>
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
        className="shrink-0 rounded-md bg-(--accent) px-3 py-1 text-xs font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:cursor-not-allowed disabled:bg-(--hover) disabled:text-(--text-faint)"
      >
        Pending Changes {count > 0 ? count : ""}
      </button>
    </div>
  );
}
