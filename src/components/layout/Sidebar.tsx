import { useState } from "react";
import { NewConnectionDialog } from "../connection/NewConnectionDialog";
import { ConnectionTree } from "../connection/ConnectionTree";
import { useConnectionsStore } from "../../stores/connectionsStore";

export function Sidebar() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const hasConnections = useConnectionsStore((s) => s.connections.length > 0);

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-black/30 bg-neutral-900/40 text-neutral-300">
      <div data-tauri-drag-region className="h-7 shrink-0" />
      <div className="flex items-center gap-2 px-3 pb-3">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35M17 10a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search connections…"
            className="w-full rounded-md border border-black/30 bg-black/20 py-1 pl-7 pr-2 text-xs text-neutral-200 outline-none transition-colors placeholder:text-neutral-500 focus:border-neutral-500"
          />
        </div>
        <button
          onClick={() => setDialogOpen(true)}
          title="New Connection"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
          </svg>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-1 pb-2">
        {hasConnections ? (
          <ConnectionTree search={search} />
        ) : (
          <div className="flex flex-col items-center gap-3 px-4 pt-10 text-center">
            <p className="text-sm text-neutral-500">No connections yet.</p>
            <button
              onClick={() => setDialogOpen(true)}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
            >
              Create your first connection
            </button>
          </div>
        )}
      </div>

      <NewConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </aside>
  );
}
