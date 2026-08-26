import type { ReactNode } from "react";

export function Panel({ children }: { children: ReactNode }) {
  return <div className="h-full overflow-y-auto px-4 py-4">{children}</div>;
}

export function DataTable({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-(--border)">
      <table className="w-full text-left text-xs">
        <thead className="bg-(--hover) text-(--text-faint)">
          <tr>
            {head.map((h, i) => (
              <th key={`${h}-${i}`} className="whitespace-nowrap px-3 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-(--border)">{children}</tbody>
      </table>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-lg border border-(--border) px-3 py-3 text-xs text-(--text-faint)">{children}</p>
  );
}

export function PanelState({ loading, error }: { loading?: boolean; error?: unknown }) {
  if (loading) {
    return <div className="px-1 py-2 text-xs text-(--text-faint)">Loading…</div>;
  }
  if (error) {
    return <div className="px-1 py-2 text-xs text-(--danger)">{(error as Error).message}</div>;
  }
  return null;
}
