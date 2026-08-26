import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands, type CsvImportOptions, type CsvPreview } from "../../bindings";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useTables } from "../../hooks/useSchema";
import { Select } from "../ui/Select";
import { friendlyError } from "../../lib/errors";

const DELIMITERS = [
  { value: ",", label: "," },
  { value: ";", label: ";" },
  { value: "\t", label: "Tab" },
  { value: "|", label: "|" },
];

const defaultOptions: CsvImportOptions = {
  firstRowIsHeader: true,
  delimiter: ",",
  emptyAsNull: true,
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
      <span className="text-xs text-(--text-muted)">{label}</span>
    </label>
  );
}

interface ImportDialogProps {
  source: "csv" | "sql";
  onClose: () => void;
}

export function ImportDialog({ source, onClose }: ImportDialogProps) {
  const connectionId = useConnectionsStore((s) => s.activeConnectionId);
  const activeSchema = useConnectionsStore((s) => s.activeSchema);
  const activeTab = useTabsStore((s) => s.tabs.find((t) => t.id === s.activeTabId));
  const schema = connectionId ? activeSchema[connectionId] : undefined;
  const queryClient = useQueryClient();

  const { data: tables } = useTables(connectionId, schema);

  const [path, setPath] = useState("");
  const [table, setTable] = useState(activeTab?.title ?? "");
  const [options, setOptions] = useState<CsvImportOptions>(defaultOptions);
  const [preview, setPreview] = useState<CsvPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  // Re-preview whenever the file or the parsing options change, so the sample
  // below always reflects what would actually be imported.
  useEffect(() => {
    if (source !== "csv" || !path) return;
    let cancelled = false;
    commands.previewCsv(path, options).then((result) => {
      if (cancelled) return;
      if (result.status === "error") {
        setError(friendlyError(result.error.message));
        setPreview(null);
      } else {
        setError(null);
        setPreview(result.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [source, path, options]);

  async function pickFile() {
    const filters =
      source === "csv"
        ? [{ name: "CSV", extensions: ["csv", "tsv", "txt"] }]
        : [{ name: "SQL", extensions: ["sql"] }];
    const picked = await openFileDialog({ multiple: false, directory: false, filters });
    if (!picked || Array.isArray(picked)) return;
    setPath(picked);
    setDone(null);
  }

  async function handleImport() {
    if (!connectionId || !path) return;
    setBusy(true);
    setError(null);

    const result =
      source === "csv"
        ? await commands.importCsv(connectionId, schema ?? null, table, path, options)
        : await commands.importSqlDump(connectionId, path);

    setBusy(false);
    if (result.status === "error") {
      setError(friendlyError(result.error.message));
      return;
    }

    // Imported rows only appear after the cached pages are dropped.
    for (const key of ["rows", "tables", "views", "columns"]) {
      queryClient.invalidateQueries({ queryKey: [key, connectionId] });
    }
    setDone(
      source === "csv"
        ? `Imported ${result.data.rowsImported} row${result.data.rowsImported === 1 ? "" : "s"}.`
        : `Ran ${result.data.statementsRun} statement${result.data.statementsRun === 1 ? "" : "s"}.`,
    );
  }

  const fileName = path.split("/").pop();
  const canImport = !!connectionId && !!path && (source === "sql" || !!table) && !busy;

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-(--bg)/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 max-h-[85vh] w-[520px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-(--border) bg-(--surface-raised) p-5 shadow-xl shadow-black/40 focus:outline-none">
          <Dialog.Title className="text-base font-semibold text-(--text)">
            {source === "csv" ? "Import from CSV" : "Import from SQL Dump"}
          </Dialog.Title>
          <Dialog.Description className="mt-1 text-sm text-(--text-faint)">
            {source === "csv"
              ? "Rows are appended to an existing table."
              : "Statements run in order against the active connection."}
          </Dialog.Description>

          <div className="mt-4 space-y-3">
            <div>
              <span className="mb-1 block text-xs font-medium text-(--text-faint)">File</span>
              <div className="flex gap-2">
                <input
                  value={fileName ?? ""}
                  readOnly
                  placeholder="No file selected"
                  title={path || undefined}
                  className="w-full flex-1 rounded-lg border border-(--border) bg-(--surface-sunken) px-3 py-1.5 text-sm text-(--text-muted) outline-none"
                />
                <button
                  onClick={pickFile}
                  className="shrink-0 rounded-lg border border-(--border-strong) px-3 text-sm font-medium text-(--text) transition-colors hover:bg-(--hover)"
                >
                  Choose…
                </button>
              </div>
            </div>

            {source === "csv" && (
              <>
                <div>
                  <span className="mb-1 block text-xs font-medium text-(--text-faint)">
                    Into table
                  </span>
                  <Select
                    value={table}
                    onChange={setTable}
                    placeholder="Pick a table"
                    options={(tables ?? []).map((t) => ({ value: t.name, label: t.name }))}
                  />
                </div>

                <div className="space-y-2 pt-1">
                  <Check
                    checked={options.firstRowIsHeader}
                    onChange={(v) => setOptions({ ...options, firstRowIsHeader: v })}
                    label="First row contains field names"
                  />
                  <Check
                    checked={options.emptyAsNull}
                    onChange={(v) => setOptions({ ...options, emptyAsNull: v })}
                    label="Treat empty fields as NULL"
                  />
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-xs text-(--text-muted)">Delimiter</span>
                    <div className="w-40">
                      <Select
                        value={options.delimiter}
                        onChange={(v) => setOptions({ ...options, delimiter: v })}
                        options={DELIMITERS}
                      />
                    </div>
                  </div>
                </div>

                {preview && preview.sampleRows.length > 0 && (
                  <div className="rounded-lg border border-(--border) bg-(--surface-sunken)">
                    <div className="border-b border-(--border) px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-(--text-faint)">
                      Preview
                    </div>
                    <div className="max-h-40 overflow-auto p-2">
                      <table className="w-full text-left text-[11px]">
                        {preview.columns.length > 0 && (
                          <thead>
                            <tr>
                              {preview.columns.map((c) => (
                                <th key={c} className="px-2 py-1 font-medium text-(--text-faint)">
                                  {c}
                                </th>
                              ))}
                            </tr>
                          </thead>
                        )}
                        <tbody>
                          {preview.sampleRows.slice(0, 5).map((row, i) => (
                            <tr key={i} className="border-t border-(--border)">
                              {row.map((cell, j) => (
                                <td key={j} className="truncate px-2 py-1 text-(--text-muted)">
                                  {cell}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {error && (
            <div className="mt-3 rounded-lg border border-(--danger)/50 bg-(--danger)/10 px-3 py-2 text-xs text-(--danger)">
              {error}
            </div>
          )}
          {done && (
            <div className="mt-3 rounded-lg border border-(--success) bg-(--success-soft) px-3 py-2 text-xs text-(--success)">
              {done}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-(--text-muted) transition-colors hover:text-(--text)"
            >
              {done ? "Done" : "Cancel"}
            </button>
            <button
              onClick={handleImport}
              disabled={!canImport}
              className="rounded-lg bg-(--accent) px-4 py-1.5 text-sm font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Importing…" : "Import"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
