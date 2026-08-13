import { useEffect, useMemo, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { save as saveFileDialog, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { commands, type CsvOptions, type ExportFormat, type ExportTableSpec } from "../../bindings";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useTables, useViews, useColumns } from "../../hooks/useSchema";
import { Select } from "../ui/Select";
import { friendlyError } from "../../lib/errors";
import { TableIcon } from "../ui/icons";

const FORMATS: ExportFormat[] = ["Csv", "Json", "Sql"];
const FORMAT_LABEL: Record<ExportFormat, string> = { Csv: "CSV", Json: "JSON", Sql: "SQL" };

const DELIMITERS = [
  { value: ",", label: "," },
  { value: ";", label: ";" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "|" },
];

const QUOTING = [
  { value: "IfNeeded", label: "Quote if needed" },
  { value: "Always", label: "Always quote" },
  { value: "Never", label: "Never quote" },
];

const LINE_BREAKS = [
  { value: "\n", label: "\\n" },
  { value: "\r\n", label: "\\r\\n" },
  { value: "\r", label: "\\r" },
];

const DECIMALS = [
  { value: ".", label: "." },
  { value: ",", label: "," },
];

const defaultCsvOptions: CsvOptions = {
  nullToEmpty: true,
  lineBreakToSpace: false,
  fieldNamesFirstRow: true,
  delimiter: ",",
  quoting: "IfNeeded",
  lineBreak: "\n",
  decimal: ".",
};

function Check({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-indigo-500"
      />
      <span className="text-xs text-neutral-300">{label}</span>
    </label>
  );
}

function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-neutral-400">{label}</span>
      <div className="w-40">{children}</div>
    </div>
  );
}

interface ExportDialogProps {
  /** `table` restricts the dialog to one table and enables column selection. */
  mode: "all" | "table";
  onClose: () => void;
}

export function ExportDialog({ mode, onClose }: ExportDialogProps) {
  const connectionId = useConnectionsStore((s) => s.activeConnectionId);
  const activeSchema = useConnectionsStore((s) => s.activeSchema);
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const schema = connectionId ? activeSchema[connectionId] : undefined;

  const { data: tables } = useTables(connectionId, schema);
  const { data: views } = useViews(connectionId, schema);

  const singleTable = mode === "table" ? activeTab?.title : undefined;
  const { data: columns } = useColumns(
    mode === "table" ? connectionId : null,
    singleTable ?? null,
    mode === "table" ? (activeTab?.schema ?? undefined) : undefined,
  );

  const allTables = useMemo(
    () => [...(tables ?? []), ...(views ?? [])].map((t) => t.name),
    [tables, views],
  );

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<ExportFormat>("Csv");
  const [csv, setCsv] = useState<CsvOptions>(defaultCsvOptions);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preselect the active table so the common case needs no clicking.
  useEffect(() => {
    if (mode === "table" && singleTable) setSelected(new Set([singleTable]));
  }, [mode, singleTable]);

  const fileBase = mode === "table" ? (singleTable ?? "export") : (
    selected.size === 1 ? [...selected][0] : "export"
  );

  function toggle(name: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === allTables.length ? new Set() : new Set(allTables)));
  }

  function toggleColumn(name: string) {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function handleExport() {
    if (!connectionId || selected.size === 0) return;
    setError(null);

    const ext = format === "Csv" ? "csv" : format === "Json" ? "json" : "sql";
    // SQL always concatenates into one dump; CSV/JSON need a directory when
    // exporting more than one table, since each becomes its own file.
    const manyFiles = format !== "Sql" && selected.size > 1;

    const destination = manyFiles
      ? await openFileDialog({ directory: true, multiple: false, title: "Choose a folder" })
      : await saveFileDialog({
          defaultPath: `${fileBase}.${ext}`,
          filters: [{ name: FORMAT_LABEL[format], extensions: [ext] }],
        });

    if (!destination || Array.isArray(destination)) return;

    const specs: ExportTableSpec[] = [...selected].map((table) => ({
      schema: schema ?? null,
      table,
      columns:
        mode === "table" && selectedColumns.size > 0 ? [...selectedColumns] : null,
    }));

    setBusy(true);
    const result = await commands.exportTables(connectionId, specs, format, csv, destination);
    setBusy(false);

    if (result.status === "error") {
      setError(friendlyError(result.error.message));
      return;
    }
    onClose();
  }

  const canExport = !!connectionId && selected.size > 0 && !busy;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 flex max-h-[85vh] w-[640px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-neutral-800 bg-neutral-900 shadow-xl shadow-black/40 focus:outline-none">
          <Dialog.Title className="border-b border-neutral-800 px-5 py-3 text-sm font-semibold text-neutral-100">
            {mode === "table" ? `Export table '${singleTable ?? ""}'` : "Export"}
          </Dialog.Title>

          <div className="flex min-h-0 flex-1">
            {/* Left: what to export */}
            <div className="flex w-1/2 min-w-0 flex-col border-r border-neutral-800">
              {mode === "all" ? (
                <>
                  <div className="flex items-center justify-between border-b border-neutral-800 px-3 py-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                      Items
                    </span>
                    <button
                      onClick={toggleAll}
                      className="text-[11px] font-medium text-indigo-400 hover:text-indigo-300"
                    >
                      {selected.size === allTables.length ? "None" : "All"}
                    </button>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-1">
                    {allTables.length === 0 && (
                      <p className="px-2 py-3 text-xs text-neutral-600">No tables on this connection.</p>
                    )}
                    {allTables.map((name) => (
                      <label
                        key={name}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-white/5"
                      >
                        <input
                          type="checkbox"
                          checked={selected.has(name)}
                          onChange={() => toggle(name)}
                          className="accent-indigo-500"
                        />
                        <TableIcon className="h-3.5 w-3.5 shrink-0 text-neutral-500" />
                        <span className="truncate text-xs text-neutral-200">{name}</span>
                      </label>
                    ))}
                  </div>
                </>
              ) : (
                <>
                  <div className="border-b border-neutral-800 px-3 py-1.5">
                    <span className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">
                      Select fields to export
                    </span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-auto p-1">
                    <p className="px-2 py-1 text-[11px] text-neutral-600">
                      {selectedColumns.size === 0
                        ? "All fields"
                        : `${selectedColumns.size} of ${columns?.length ?? 0} fields`}
                    </p>
                    {(columns ?? []).map((c) => (
                      <label
                        key={c.name}
                        className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-white/5"
                      >
                        <input
                          type="checkbox"
                          checked={selectedColumns.has(c.name)}
                          onChange={() => toggleColumn(c.name)}
                          className="accent-indigo-500"
                        />
                        <span className="truncate text-xs text-neutral-200">{c.name}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-neutral-600">
                          {c.dataType}
                        </span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>

            {/* Right: format and options */}
            <div className="flex w-1/2 min-w-0 flex-col">
              <div className="flex gap-1 border-b border-neutral-800 px-3 py-2">
                {FORMATS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      format === f
                        ? "bg-indigo-600 text-white"
                        : "text-neutral-400 hover:bg-white/5 hover:text-neutral-200"
                    }`}
                  >
                    {FORMAT_LABEL[f]}
                  </button>
                ))}
              </div>

              <div className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
                {format === "Csv" && (
                  <>
                    <Check
                      checked={csv.nullToEmpty}
                      onChange={(v) => setCsv({ ...csv, nullToEmpty: v })}
                      label="Convert NULL to EMPTY"
                    />
                    <Check
                      checked={csv.lineBreakToSpace}
                      onChange={(v) => setCsv({ ...csv, lineBreakToSpace: v })}
                      label="Convert line break to space"
                    />
                    <Check
                      checked={csv.fieldNamesFirstRow}
                      onChange={(v) => setCsv({ ...csv, fieldNamesFirstRow: v })}
                      label="Put field names in the first row"
                    />
                    <div className="space-y-2 pt-1">
                      <OptionRow label="Delimiter">
                        <Select
                          value={csv.delimiter}
                          onChange={(v) => setCsv({ ...csv, delimiter: v })}
                          options={DELIMITERS}
                        />
                      </OptionRow>
                      <OptionRow label="Swap">
                        <Select
                          value={csv.quoting}
                          onChange={(v) => setCsv({ ...csv, quoting: v as CsvOptions["quoting"] })}
                          options={QUOTING}
                        />
                      </OptionRow>
                      <OptionRow label="Line break">
                        <Select
                          value={csv.lineBreak}
                          onChange={(v) => setCsv({ ...csv, lineBreak: v })}
                          options={LINE_BREAKS}
                        />
                      </OptionRow>
                      <OptionRow label="Decimal">
                        <Select
                          value={csv.decimal}
                          onChange={(v) => setCsv({ ...csv, decimal: v })}
                          options={DECIMALS}
                        />
                      </OptionRow>
                    </div>
                  </>
                )}

                {format === "Json" && (
                  <p className="text-xs leading-relaxed text-neutral-500">
                    Each table is written as an array of objects keyed by column name. Numbers stay
                    numeric; decimals are kept as strings so no precision is lost.
                  </p>
                )}

                {format === "Sql" && (
                  <p className="text-xs leading-relaxed text-neutral-500">
                    Writes one <code className="text-neutral-400">INSERT</code> per row into a single
                    .sql file, with identifiers quoted for this connection's dialect.
                  </p>
                )}
              </div>

              <div className="border-t border-neutral-800 px-4 py-2 text-xs text-neutral-500">
                File name: <span className="text-neutral-300">{fileBase}</span>
              </div>
            </div>
          </div>

          {error && (
            <div className="mx-5 mb-2 rounded-lg border border-red-900/50 bg-red-950/50 px-3 py-2 text-xs text-red-300">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-neutral-800 px-5 py-3">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-200"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={!canExport}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Exporting…" : "Export…"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
