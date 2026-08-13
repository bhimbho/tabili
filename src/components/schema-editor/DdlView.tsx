import { useState } from "react";
import { useTableDdl } from "../../hooks/useSchema";
import { Panel, PanelState } from "./panels";

export function DdlView({ connectionId, table, schema }: { connectionId: string; table: string; schema: string | null }) {
  const { data: ddl, isLoading, error } = useTableDdl(connectionId, table, schema ?? undefined);
  const [copied, setCopied] = useState(false);

  if (isLoading || error) {
    return (
      <Panel>
        <PanelState loading={isLoading} error={error} />
      </Panel>
    );
  }

  async function copy() {
    if (!ddl) return;
    await navigator.clipboard.writeText(ddl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <Panel>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
          Create statement
        </h3>
        <button
          onClick={copy}
          className="rounded-md px-2 py-1 text-xs font-medium text-neutral-400 transition-colors hover:bg-white/10 hover:text-neutral-100"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="selectable overflow-x-auto rounded-lg border border-neutral-800 bg-black/30 px-3 py-3 font-mono text-xs leading-relaxed text-neutral-300">
        {ddl}
      </pre>
    </Panel>
  );
}
