import type { ReactNode } from "react";
import { PAGE_SIZE } from "../../hooks/useTableData";

interface GridFooterProps {
  /** The data/structure/indexes/… view selector. */
  children: ReactNode;
  /** Paging only applies to the data view. */
  showPaging: boolean;
  rowCount: number;
  hasMore: boolean;
  /** Zero-based. */
  page: number;
  onPageChange: (page: number) => void;
  busy: boolean;
}

const pageButton =
  "flex h-5 w-5 items-center justify-center rounded text-xs text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100 disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent";

/**
 * The bar under the grid: which view you are in on the left, where you are in
 * the result set on the right. Both describe the content rather than acting on
 * it, which is why they sit below it and the toolbar above holds only actions.
 */
export function GridFooter({
  children,
  showPaging,
  rowCount,
  hasMore,
  page,
  onPageChange,
  busy,
}: GridFooterProps) {
  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-t border-black/40 bg-white/[0.02] px-3">
      {children}

      {showPaging && (
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-xs tabular-nums text-neutral-500">
            {busy
              ? "…"
              : rowCount === 0
                ? "No rows"
                : `${(page * PAGE_SIZE + 1).toLocaleString()}–${(
                    page * PAGE_SIZE + rowCount
                  ).toLocaleString()}`}
          </span>
          {/* A page at a time: the row count is an estimate at best, so there
              is no last-page number to offer. */}
          <button
            onClick={() => onPageChange(page - 1)}
            disabled={page === 0 || busy}
            title="Previous page"
            className={pageButton}
          >
            &lsaquo;
          </button>
          <button
            onClick={() => onPageChange(page + 1)}
            disabled={!hasMore || busy}
            title="Next page"
            className={pageButton}
          >
            &rsaquo;
          </button>
        </div>
      )}
    </div>
  );
}
