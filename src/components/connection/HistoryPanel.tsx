import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { useStatementLog, useSavedQueries } from "../../hooks/useConnections";
import { ContextMenu, useContextMenu, type MenuEntry } from "../ui/ContextMenu";
import { friendlyError } from "../../lib/errors";

function when(ts: string) {
  const d = new Date(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, { hour12: false });
}

export function HistoryPanel({ search }: { search: string }) {
  const { data: entries, isLoading } = useStatementLog();
  const queryClient = useQueryClient();
  const menu = useContextMenu();
  const [target, setTarget] = useState<string | null>(null);

  const needle = search.trim().toLowerCase();
  const shown = (entries ?? []).filter((e) => !needle || e.sql.toLowerCase().includes(needle));

  const items: MenuEntry[] = [
    { label: "Copy SQL", onSelect: () => target && navigator.clipboard.writeText(target) },
    {
      label: "Save to Queries…",
      onSelect: async () => {
        if (!target) return;
        const name = target.slice(0, 40);
        await commands.saveQuery(name, target);
        queryClient.invalidateQueries({ queryKey: ["saved-queries"] });
      },
    },
    null,
    {
      label: "Clear history",
      danger: true,
      onSelect: async () => {
        await commands.clearStatementLog();
        queryClient.invalidateQueries({ queryKey: ["statement-log"] });
      },
    },
  ];

  if (isLoading) return <p className="px-3 py-2 text-xs text-neutral-500">Loading…</p>;
  if (shown.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-neutral-600">
        {needle ? "No matches." : "Nothing run yet."}
      </p>
    );
  }

  return (
    <div className="py-1">
      {shown.map((e) => (
        <div
          key={e.id}
          onContextMenu={(ev) => {
            setTarget(e.sql);
            menu.open(ev);
          }}
          className="cursor-default rounded-md px-2 py-1 transition-colors hover:bg-white/5"
          title={e.error ? friendlyError(e.error) : e.sql}
        >
          <div
            className={`truncate font-mono text-[11px] ${e.success ? "text-neutral-300" : "text-red-400"}`}
          >
            {e.sql}
          </div>
          <div className="flex items-center gap-2 text-[10px] text-neutral-600">
            <span>{when(e.executedAt)}</span>
            <span>· {e.durationMs} ms</span>
            {!e.success && <span className="text-red-500">· failed</span>}
          </div>
        </div>
      ))}
      <ContextMenu position={menu.position} items={items} onClose={menu.close} />
    </div>
  );
}

export function QueriesPanel({ search }: { search: string }) {
  const { data: queries, isLoading } = useSavedQueries();
  const queryClient = useQueryClient();
  const menu = useContextMenu();
  const [target, setTarget] = useState<{ id: string; sql: string } | null>(null);

  const needle = search.trim().toLowerCase();
  const shown = (queries ?? []).filter(
    (q) => !needle || q.name.toLowerCase().includes(needle) || q.sql.toLowerCase().includes(needle),
  );

  const items: MenuEntry[] = [
    { label: "Copy SQL", onSelect: () => target && navigator.clipboard.writeText(target.sql) },
    null,
    {
      label: "Delete",
      danger: true,
      onSelect: async () => {
        if (!target) return;
        await commands.deleteSavedQuery(target.id);
        queryClient.invalidateQueries({ queryKey: ["saved-queries"] });
      },
    },
  ];

  if (isLoading) return <p className="px-3 py-2 text-xs text-neutral-500">Loading…</p>;
  if (shown.length === 0) {
    return (
      <p className="px-3 py-2 text-xs text-neutral-600">
        {needle
          ? "No matches."
          : "No saved queries. Right-click a statement in History to save it here."}
      </p>
    );
  }

  return (
    <div className="py-1">
      {shown.map((q) => (
        <div
          key={q.id}
          onContextMenu={(ev) => {
            setTarget({ id: q.id, sql: q.sql });
            menu.open(ev);
          }}
          className="cursor-default rounded-md px-2 py-1 transition-colors hover:bg-white/5"
          title={q.sql}
        >
          <div className="truncate text-xs text-neutral-200">{q.name}</div>
          <div className="truncate font-mono text-[10px] text-neutral-600">{q.sql}</div>
        </div>
      ))}
      <ContextMenu position={menu.position} items={items} onClose={menu.close} />
    </div>
  );
}
