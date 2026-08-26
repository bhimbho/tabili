import { useConsoleStore } from "../../stores/consoleStore";

function time(at: number) {
  return new Date(at).toLocaleTimeString(undefined, { hour12: false });
}

export function ConsolePanel() {
  const { entries, open, clear, setOpen } = useConsoleStore();

  if (!open) return null;

  return (
    <div className="edge-highlight flex h-56 shrink-0 flex-col border-t border-black/50 bg-[#111113]">
      <div className="flex h-8 shrink-0 items-center justify-between border-b border-neutral-800 px-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Console
        </span>
        <div className="flex items-center gap-2">
          <button
            onClick={clear}
            className="rounded-md px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:text-neutral-200"
          >
            Clear
          </button>
          <button
            onClick={() => setOpen(false)}
            title="Hide console (⌘J)"
            className="rounded-md px-2 py-0.5 text-xs text-neutral-500 transition-colors hover:text-neutral-200"
          >
            Hide
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {entries.length === 0 ? (
          <p className="text-xs text-neutral-600">
            Statements run by Tabili appear here as they execute.
          </p>
        ) : (
          <div className="space-y-1.5">
            {entries.map((e) => (
              <div key={e.id} className="selectable font-mono text-[11px] leading-relaxed">
                <div className="flex items-baseline gap-2">
                  <span className="shrink-0 text-neutral-600">{time(e.at)}</span>
                  <span className={e.success ? "text-neutral-300" : "text-red-400"}>
                    {e.sql}
                  </span>
                  {e.durationMs !== undefined && (
                    <span className="ml-auto shrink-0 text-neutral-600">{e.durationMs} ms</span>
                  )}
                </div>
                {e.error && <div className="pl-[62px] text-red-400/80">{e.error}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
