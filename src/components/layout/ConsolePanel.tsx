import { useConsoleStore } from "../../stores/consoleStore";

function time(at: number) {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

export function ConsolePanel() {
  const { entries, open, clear, setOpen } = useConsoleStore();

  if (!open) return null;

  return (
    <div className="flex h-56 shrink-0 flex-col border-t border-(--border) bg-(--surface)">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-(--border) px-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
          Console
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={clear}
            className="rounded-md px-2 py-0.5 text-xs text-(--text-faint) transition-colors hover:text-(--text-muted)"
          >
            Clear
          </button>
          <button
            onClick={() => setOpen(false)}
            title="Hide console (⌘J)"
            className="rounded-md px-2 py-0.5 text-xs text-(--text-faint) transition-colors hover:text-(--text-muted)"
          >
            Hide
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {entries.length === 0 ? (
          <p className="text-xs text-(--text-faint)">
            Statements run by Tabili appear here as they execute.
          </p>
        ) : (
          <div className="space-y-1.5">
            {entries.map((e) => (
              <div key={e.id} className="selectable font-mono text-[11px] leading-relaxed">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-(--text-faint)">{time(e.at)}</span>
                  <span className={e.success ? "text-(--text-muted)" : "text-(--danger)"}>
                    {e.sql}
                  </span>
                  {e.durationMs !== undefined && (
                    <span className="ml-auto shrink-0 text-(--text-faint)">{e.durationMs} ms</span>
                  )}
                </div>
                {e.error && <div className="pl-[62px] text-(--danger)/80">{e.error}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
