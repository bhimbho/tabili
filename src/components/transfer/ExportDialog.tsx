import { useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { save as saveFileDialog, open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { commands, type CsvOptions, type ExportFormat, type ExportTableSpec } from "../../bindings";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { useTabsStore } from "../../stores/tabsStore";
import { useSchemas, useColumns } from "../../hooks/useSchema";
import { Select } from "../ui/Select";
import { friendlyError } from "../../lib/errors";
import { TableIcon } from "../ui/icons";
import { DialogCloseButton } from "../ui/DialogCloseButton";

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
  title,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  title?: string;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-1.5" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-indigo-500"
      />
      {label && <span className="text-xs text-(--text-muted)">{label}</span>}
    </label>
  );
}

function OptionRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-(--text-muted)">{label}</span>
      <div className="w-40">{children}</div>
    </div>
  );
}

interface ItemState {
  selected: boolean;
  structure: boolean;
  drop: boolean;
  data: boolean;
}

function itemKey(schema: string, name: string) {
  return schema ? `${schema}.${name}` : name;
}

function parseKey(key: string): { schema: string | null; table: string } {
  const idx = key.indexOf(".");
  if (idx === -1) return { schema: null, table: key };
  return { schema: key.slice(0, idx), table: key.slice(idx + 1) };
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

  const { data: schemasData } = useSchemas(connectionId);
  const singleTable = mode === "table" ? activeTab?.title : undefined;
  const singleSchema = mode === "table" ? (activeTab?.schema ?? schema) : undefined;

  const { data: columns } = useColumns(
    mode === "table" ? connectionId : null,
    singleTable ?? null,
    singleSchema,
  );

  const [itemMap, setItemMap] = useState<Map<string, ItemState>>(new Map());
  const [schemaItems, setSchemaItems] = useState<Map<string, { tables: { name: string }[]; views: { name: string }[] }>>(new Map());
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [format, setFormat] = useState<ExportFormat>("Csv");
  const [csv, setCsv] = useState<CsvOptions>(defaultCsvOptions);
  const [gzip, setGzip] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initializedRef = useRef(false);

  const effectiveSchemas = useMemo(() => {
    if (schemasData && schemasData.length > 0) return schemasData.map((s) => s.name);
    return [schema ?? ""];
  }, [schemasData, schema]);

  // Load tables/views for every schema once.
  useEffect(() => {
    if (!connectionId || initializedRef.current) return;
    if (schemasData === undefined) return; // still loading schemas

    let cancelled = false;
    async function load() {
      const map = new Map<string, { tables: { name: string }[]; views: { name: string }[] }>();
      const items = new Map<string, ItemState>();
      for (const s of effectiveSchemas) {
        const [tResult, vResult] = await Promise.all([
          commands.listTables(connectionId as string, s || null),
          commands.listViews(connectionId as string, s || null),
        ]);
        if (cancelled) return;
        const tables = tResult.status === "ok" ? tResult.data : [];
        const views = vResult.status === "ok" ? vResult.data : [];
        map.set(s, { tables, views });
        [...tables, ...views].forEach((item) => {
          const key = itemKey(s, item.name);
          const isSingle = mode === "table" && item.name === singleTable && s === (singleSchema ?? "");
          items.set(key, { selected: isSingle, structure: true, drop: false, data: true });
        });
      }
      if (!cancelled) {
        setSchemaItems(map);
        setItemMap(items);
        initializedRef.current = true;
      }
    }
    load();
    return () => { cancelled = true; };
  }, [connectionId, schemasData, effectiveSchemas, mode, singleTable, singleSchema]);

  const exportCount = useMemo(() => {
    let count = 0;
    for (const v of itemMap.values()) {
      if (format === "Sql") {
        if (v.structure || v.drop || v.data) count++;
      } else if (v.data) {
        count++;
      }
    }
    return count;
  }, [itemMap, format]);

  const fileBase = mode === "table" ? (singleTable ?? "export") : (
    exportCount === 1
      ? (() => {
          for (const [k, v] of itemMap) {
            const included = format === "Sql" ? (v.structure || v.drop || v.data) : v.data;
            if (included) return parseKey(k).table;
          }
          return "export";
        })()
      : "export"
  );

  function setItemFlag(key: string, flag: keyof Omit<ItemState, "selected">, value: boolean) {
    setItemMap((prev) => {
      const next = new Map(prev);
      const cur = next.get(key);
      if (cur) next.set(key, { ...cur, [flag]: value });
      return next;
    });
  }

  function toggleColumn(name: string) {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  function schemaKeys(schema: string): string[] {
    const keys: string[] = [];
    for (const k of itemMap.keys()) {
      const parsed = parseKey(k);
      if (parsed.schema === schema || (schema === "" && !parsed.schema)) keys.push(k);
    }
    return keys;
  }

  function toggleAllInSchema(schema: string) {
    const keys = schemaKeys(schema);
    setItemMap((prev) => {
      const next = new Map(prev);
      const allSelected = keys.every((k) => next.get(k)?.selected);
      for (const k of keys) {
        const cur = next.get(k);
        if (cur) next.set(k, { ...cur, selected: !allSelected });
      }
      return next;
    });
  }

  function schemaMasterFlagValue(
    schema: string,
    flag: keyof Omit<ItemState, "selected">,
  ): boolean | "indeterminate" {
    const keys = schemaKeys(schema);
    const vals: boolean[] = [];
    for (const k of keys) {
      const v = itemMap.get(k);
      if (v) vals.push(v[flag]);
    }
    if (vals.length === 0) return false;
    if (vals.every((v) => v)) return true;
    if (vals.every((v) => !v)) return false;
    return "indeterminate";
  }

  function toggleSchemaMaster(schema: string, flag: keyof Omit<ItemState, "selected">) {
    const current = schemaMasterFlagValue(schema, flag);
    const target = current === true ? false : true;
    const keys = schemaKeys(schema);
    setItemMap((prev) => {
      const next = new Map(prev);
      for (const k of keys) {
        const cur = next.get(k);
        if (cur) next.set(k, { ...cur, [flag]: target });
      }
      return next;
    });
  }

  async function handleExport() {
    if (!connectionId || exportCount === 0) return;
    setError(null);

    const ext = format === "Csv" ? "csv" : format === "Json" ? "json" : "sql";
    const filterExt = gzip ? "gz" : ext;
    const manyFiles = format !== "Sql" && exportCount > 1;

    const destination = manyFiles
      ? await openFileDialog({ directory: true, multiple: false, title: "Choose a folder" })
      : await saveFileDialog({
          defaultPath: `${fileBase}.${ext}${gzip ? ".gz" : ""}`,
          filters: [{ name: FORMAT_LABEL[format], extensions: [filterExt] }],
        });

    if (!destination || Array.isArray(destination)) return;

    const specs: ExportTableSpec[] = [];
    for (const [key, item] of itemMap) {
      const included = format === "Sql" ? (item.structure || item.drop || item.data) : item.data;
      if (!included) continue;
      const { schema: s, table } = parseKey(key);
      specs.push({
        schema: s,
        table,
        columns: mode === "table" && selectedColumns.size > 0 ? [...selectedColumns] : null,
        includeStructure: item.structure,
        includeDrop: item.drop,
        includeData: item.data,
      });
    }

    setBusy(true);
    const result = await commands.exportTables(connectionId, specs, format, csv, destination, gzip);
    setBusy(false);

    if (result.status === "error") {
      setError(friendlyError(result.error.message));
      return;
    }
    onClose();
  }

  const canExport = !!connectionId && exportCount > 0 && !busy;

  const leftPanel = () => {
    if (mode === "table" && format !== "Sql") {
      // Column selection for CSV/JSON in table mode
      return (
        <>
          <div className="border-b border-(--border) px-3 py-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-(--text-faint)">
              Select fields to export
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-1">
            <p className="px-2 py-1 text-[11px] text-(--text-faint)">
              {selectedColumns.size === 0
                ? "All fields"
                : `${selectedColumns.size} of ${columns?.length ?? 0} fields`}
            </p>
            {(columns ?? []).map((c) => (
              <label
                key={c.name}
                className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 hover:bg-(--hover)"
              >
                <input
                  type="checkbox"
                  checked={selectedColumns.has(c.name)}
                  onChange={() => toggleColumn(c.name)}
                  className="accent-indigo-500"
                />
                <span className="truncate text-xs text-(--text)">{c.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-(--text-faint)">
                  {c.dataType}
                </span>
              </label>
            ))}
          </div>
        </>
      );
    }

    // Schema-grouped item list
    const schemaList = [...schemaItems.entries()];
    const totalItems = schemaList.reduce((sum, [, { tables, views }]) => sum + tables.length + views.length, 0);

    return (
      <>
        <div className="flex items-center border-b border-(--border) px-3 py-1.5">
          <span className="flex-1 text-[11px] font-medium uppercase tracking-wide text-(--text-faint)">
            Items
          </span>
          {format === "Sql" ? (
            <>
              <div className="flex w-[52px] items-center justify-center">
                <span className="text-[11px] font-medium tracking-wide text-(--text-faint)">Structure</span>
              </div>
              <div className="flex w-[52px] items-center justify-center">
                <span className="text-[11px] font-medium tracking-wide text-(--text-faint)">Drop</span>
              </div>
              <div className="flex w-[52px] items-center justify-center">
                <span className="text-[11px] font-medium tracking-wide text-(--text-faint)">Data</span>
              </div>
            </>
          ) : (
            <div className="flex w-[52px] items-center justify-center">
              <span className="text-[11px] font-medium tracking-wide text-(--text-faint)">Data</span>
            </div>
          )}
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-1">
          {totalItems === 0 && (
            <p className="px-2 py-3 text-xs text-(--text-faint)">No tables on this connection.</p>
          )}
          {schemaList.map(([sName, { tables, views }]) => {
            const items = [...tables, ...views];
            if (items.length === 0) return null;
            const sKey = sName || "default";
            return (
              <div key={sKey}>
                <div
                  className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-0.5 hover:bg-(--hover)"
                  onClick={() => toggleAllInSchema(sName)}
                >
                  <span className="flex-1 text-[10px] font-semibold uppercase tracking-wide text-(--text-faint)">
                    {sName || "(default)"}
                  </span>
                  {format === "Sql" ? (
                    <>
                      <div className="flex w-[52px] items-center justify-center">
                        <Check
                          title="Structure"
                          checked={schemaMasterFlagValue(sName, "structure") === true}
                          onChange={() => toggleSchemaMaster(sName, "structure")}
                        />
                      </div>
                      <div className="flex w-[52px] items-center justify-center">
                        <Check
                          title="Drop"
                          checked={schemaMasterFlagValue(sName, "drop") === true}
                          onChange={() => toggleSchemaMaster(sName, "drop")}
                        />
                      </div>
                      <div className="flex w-[52px] items-center justify-center">
                        <Check
                          title="Data"
                          checked={schemaMasterFlagValue(sName, "data") === true}
                          onChange={() => toggleSchemaMaster(sName, "data")}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="flex w-[52px] items-center justify-center">
                      <Check
                        title="Data"
                        checked={schemaMasterFlagValue(sName, "data") === true}
                        onChange={() => toggleSchemaMaster(sName, "data")}
                      />
                    </div>
                  )}
                </div>
                {items.map((item) => {
                  const key = itemKey(sName, item.name);
                  const state = itemMap.get(key);
                  if (!state) return null;
                  return (
                    <label
                      key={key}
                      className="flex cursor-pointer items-center gap-1.5 rounded px-2 py-1 hover:bg-(--hover)"
                    >
                      <TableIcon className="h-3.5 w-3.5 shrink-0 text-(--text-faint)" />
                      <span className="flex-1 truncate text-xs text-(--text)">{item.name}</span>
                      {format === "Sql" ? (
                        <>
                          <div className="flex w-[52px] items-center justify-center">
                            <Check
                              title="Structure"
                              checked={state.structure}
                              onChange={(v) => setItemFlag(key, "structure", v)}
                            />
                          </div>
                          <div className="flex w-[52px] items-center justify-center">
                            <Check
                              title="Drop"
                              checked={state.drop}
                              onChange={(v) => setItemFlag(key, "drop", v)}
                            />
                          </div>
                          <div className="flex w-[52px] items-center justify-center">
                            <Check
                              title="Data"
                              checked={state.data}
                              onChange={(v) => setItemFlag(key, "data", v)}
                            />
                          </div>
                        </>
                      ) : (
                        <div className="flex w-[52px] items-center justify-center">
                          <Check
                            title="Data"
                            checked={state.data}
                            onChange={(v) => setItemFlag(key, "data", v)}
                          />
                        </div>
                      )}
                    </label>
                  );
                })}
              </div>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-(--bg)/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 flex max-h-[85vh] w-[640px] -translate-x-1/2 -translate-y-1/2 flex-col rounded-xl border border-(--border) bg-(--surface-raised) shadow-xl shadow-black/40 focus:outline-none">
          <DialogCloseButton onClose={onClose} />
          <Dialog.Title className="border-b border-(--border) px-5 py-3 text-sm font-semibold text-(--text)">
            {mode === "table" ? `Export table '${singleTable ?? ""}'` : "Export"}
          </Dialog.Title>

          <div className="flex min-h-0 flex-1">
            {/* Left: what to export */}
            <div className="flex w-1/2 min-w-0 flex-col border-r border-(--border)">
              {leftPanel()}
            </div>

            {/* Right: format and options */}
            <div className="flex w-1/2 min-w-0 flex-col">
              <div className="flex gap-1 border-b border-(--border) px-3 py-2">
                {FORMATS.map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
                      format === f
                        ? "bg-(--accent) text-(--accent-text)"
                        : "text-(--text-muted) hover:bg-(--hover) hover:text-(--text-muted)"
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
                  <p className="text-xs leading-relaxed text-(--text-faint)">
                    Each table is written as an array of objects keyed by column name. Numbers stay
                    numeric; decimals are kept as strings so no precision is lost.
                  </p>
                )}

                {format === "Sql" && (
                  <>
                    <Check
                      checked={gzip}
                      onChange={setGzip}
                      label="Compress file using Gzip"
                    />
                    <p className="text-xs leading-relaxed text-(--text-faint)">
                      One .sql file is produced per export. Selected items are ordered by schema.
                      Structure writes CREATE statements, Drop writes DROP TABLE IF EXISTS, Data writes INSERTs.
                    </p>
                  </>
                )}
              </div>

              <div className="border-t border-(--border) px-4 py-2 text-xs text-(--text-faint)">
                File name:{" "}
                <span className="text-(--text)">
                  {fileBase}.{format === "Csv" ? "csv" : format === "Json" ? "json" : "sql"}
                  {gzip ? ".gz" : ""}
                </span>
              </div>
            </div>
          </div>

          {error && (
            <div className="mx-5 mb-2 rounded-lg border border-(--danger)/50 bg-(--danger)/10 px-3 py-2 text-xs text-(--danger)">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-(--border) px-5 py-3">
            <button
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm text-(--text-muted) transition-colors hover:text-(--text)"
            >
              Cancel
            </button>
            <button
              onClick={handleExport}
              disabled={!canExport}
              className="rounded-lg bg-(--accent) px-4 py-1.5 text-sm font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Exporting…" : "Export…"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

// end of file
