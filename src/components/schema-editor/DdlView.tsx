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
        <h3 className="text-xs font-semibold uppercase tracking-wide text-(--text-faint)">
          Create statement
        </h3>
        <button
          onClick={copy}
          className="rounded-md px-2 py-1 text-xs font-medium text-(--text-muted) transition-colors hover:bg-(--active) hover:text-(--text)"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="selectable overflow-x-auto rounded-lg border border-(--border) bg-(--surface-sunken) px-3 py-3 font-mono text-xs leading-relaxed text-(--text-muted)">
        {ddl}
      </pre>
    </Panel>
  );
}
