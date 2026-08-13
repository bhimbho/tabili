import { useConnectionsStore } from "../../stores/connectionsStore";
import { useChangesStore } from "../../stores/changesStore";
import { useConsoleStore } from "../../stores/consoleStore";

interface StatusBarProps {
  appVersion?: string;
}

export function StatusBar({ appVersion }: StatusBarProps) {
  const activeId = useConnectionsStore((s) => s.activeConnectionId);
  const connections = useConnectionsStore((s) => s.connections);
  const pending = useChangesStore((s) => s.count());
  const { open: consoleOpen, toggle } = useConsoleStore();

  const connection = connections.find((c) => c.id === activeId);
  const connectedCount = connections.filter((c) => c.isConnected).length;

  const status = connection
    ? connection.isConnected
      ? `Connected · ${connection.name}`
      : `Not connected · ${connection.name}`
    : connectedCount > 0
      ? `${connectedCount} connection${connectedCount === 1 ? "" : "s"} open`
      : "No active connection";

  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-500">
      <div className="flex items-center gap-2">
        {connection && (
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{
              backgroundColor: connection.isConnected ? connection.accentColor : "#6b7280",
            }}
          />
        )}
        <span>{status}</span>
        {pending > 0 && (
          <span className="text-amber-500">
            · {pending} unsaved change{pending === 1 ? "" : "s"} (⌘S to commit)
          </span>
        )}
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={toggle}
          title="Toggle console (⌘J)"
          className={`rounded px-1.5 transition-colors hover:text-neutral-200 ${
            consoleOpen ? "text-neutral-300" : ""
          }`}
        >
          Console
        </button>
        <span>{appVersion ? `tabili v${appVersion}` : "tabili"}</span>
      </div>
    </footer>
  );
}
