import { useCallback, useEffect, useMemo, useState } from "react";
import DataEditor, {
  GridCellKind,
  CompactSelection,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import type { ColumnInfo, DbValue } from "../../bindings";
import { useChangesStore, pkKeyOf } from "../../stores/changesStore";
import { ContextMenu, type MenuEntry, type MenuPosition } from "../ui/ContextMenu";
import { darkGridTheme, DELETE_THEME, EDIT_THEME, INSERT_THEME } from "./gridTheme";

/** column -> the table/column it points at, used for the jump affordance. */
export type FkMap = Record<string, { table: string; column: string }>;

/** Width of the clickable arrow zone at the right edge of a foreign-key cell. */
const FK_HIT_WIDTH = 26;

interface DataGridProps {
  connectionId: string;
  table: string;
  columns: string[];
  rows: Record<string, DbValue>[];
  columnInfos: ColumnInfo[];
  schema: string | null;
  sortColumn?: string | null;
  sortDesc?: boolean;
  onToggleSort?: (column: string) => void;
  foreignKeys?: FkMap;
  onFollowForeignKey?: (target: { table: string; column: string }, value: DbValue) => void;
  onActiveRowChange?: (row: Record<string, DbValue> | null) => void;
}

function displayValue(value: DbValue | undefined): string {
  if (!value) return "";
  switch (value.type) {
    case "Null":
      return "";
    case "Bool":
      return value.value ? "true" : "false";
    case "Int":
    case "Float":
      return String(value.value);
    case "Decimal":
    case "Text":
    case "DateTime":
    case "Uuid":
      return value.value;
    case "Bytes":
      return "<blob>";
    case "Json":
      return JSON.stringify(value.value);
    case "Array":
      return `[${value.value.length} items]`;
    case "Unsupported":
      return value.value.raw;
    default:
      return "";
  }
}

function isEditableValue(value: DbValue | undefined): boolean {
  if (!value) return true;
  return !["Bytes", "Json", "Array", "Unsupported"].includes(value.type);
}

/** Round-trips edited text back into a DbValue matching the original cell's variant. */
function parseEditedValue(original: DbValue | undefined, text: string): DbValue {
  if (text === "") return { type: "Null" };
  const kind = original?.type ?? "Text";
  switch (kind) {
    case "Bool":
      return { type: "Bool", value: text.trim().toLowerCase() === "true" };
    case "Int": {
      const n = parseInt(text, 10);
      return Number.isNaN(n) ? { type: "Text", value: text } : { type: "Int", value: n };
    }
    case "Float": {
      const n = parseFloat(text);
      return Number.isNaN(n) ? { type: "Text", value: text } : { type: "Float", value: n };
    }
    case "Decimal":
      return { type: "Decimal", value: text };
    case "DateTime":
      return { type: "DateTime", value: text };
    case "Uuid":
      return { type: "Uuid", value: text };
    default:
      return { type: "Text", value: text };
  }
}

export function DataGrid({
  connectionId,
  table,
  schema,
  columns,
  rows,
  columnInfos,
  sortColumn,
  sortDesc,
  onToggleSort,
  foreignKeys = {},
  onFollowForeignKey,
  onActiveRowChange,
}: DataGridProps) {
  const [selection, setSelection] = useState<GridSelection>({
    rows: CompactSelection.empty(),
    columns: CompactSelection.empty(),
  });

  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [menuTarget, setMenuTarget] = useState<{ col: number; row: number } | null>(null);

  const edits = useChangesStore((s) => s.edits);
  const inserts = useChangesStore((s) => s.inserts);
  const deletes = useChangesStore((s) => s.deletes);
  const setEdit = useChangesStore((s) => s.setEdit);
  const setInsertValue = useChangesStore((s) => s.setInsertValue);
  const toggleDelete = useChangesStore((s) => s.toggleDelete);
  const removeInsert = useChangesStore((s) => s.removeInsert);

  const pkColumns = useMemo(() => columnInfos.filter((c) => c.isPrimaryKey).map((c) => c.name), [columnInfos]);
  const hasPk = pkColumns.length > 0;

  const insertRows = useMemo(
    () => Array.from(inserts.values()).filter((i) => i.connectionId === connectionId && i.table === table),
    [inserts, connectionId, table],
  );

  const extractPk = useCallback(
    (row: Record<string, DbValue>) => Object.fromEntries(pkColumns.map((c) => [c, row[c]])),
    [pkColumns],
  );

  // Display order and widths are view state, independent of the underlying table's
  // column order — reset whenever we switch to a different set of columns.
  const [order, setOrder] = useState<string[]>(columns);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const columnsKey = columns.join("\u0000");
  useEffect(() => {
    setOrder(columns);
  }, [columnsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const ordered = useMemo(
    () => (order.length === columns.length ? order : columns),
    [order, columns],
  );

  const gridColumns = useMemo<GridColumn[]>(
    () =>
      ordered.map((name) => ({
        // Sort direction is shown in the title since a canvas grid has no header DOM
        // to decorate.
        title: name === sortColumn ? `${name} ${sortDesc ? "↓" : "↑"}` : name,
        id: name,
        width: widths[name] ?? 180,
      })),
    [ordered, widths, sortColumn, sortDesc],
  );

  const onColumnMoved = useCallback((from: number, to: number) => {
    setOrder((prev) => {
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }, []);

  const onColumnResize = useCallback((col: GridColumn, newSize: number) => {
    if (col.id) setWidths((prev) => ({ ...prev, [col.id as string]: newSize }));
  }, []);

  const getCellContent = useCallback(
    (cell: Item): GridCell => {
      const [col, rowIdx] = cell;
      const columnName = ordered[col];

      if (rowIdx >= rows.length) {
        const insertRow = insertRows[rowIdx - rows.length];
        const value = insertRow?.values[columnName];
        const display = displayValue(value);
        return {
          kind: GridCellKind.Text,
          data: display,
          displayData: display,
          allowOverlay: true,
          themeOverride: INSERT_THEME,
        };
      }

      const row = rows[rowIdx];
      const value = row?.[columnName];
      const pk = hasPk ? extractPk(row) : {};
      const pkKey = hasPk ? pkKeyOf(pk) : "";
      const editKey = `${connectionId}:${table}:${pkKey}:${columnName}`;
      const edit = hasPk ? edits.get(editKey) : undefined;
      const deleted = hasPk && Array.from(deletes.values()).some((d) => d.pkKey === pkKey);

      const shown = edit ? edit.newValue : value;
      const display = displayValue(shown);
      const fk = foreignKeys[columnName];
      // A trailing arrow marks the clickable jump zone. The value keeps normal
      // cell styling so foreign keys don't stand out as differently-typed data.
      const isLinkable = fk !== undefined && shown !== undefined && shown.type !== "Null";

      return {
        kind: GridCellKind.Text,
        data: display,
        displayData: isLinkable ? `${display}  →` : display,
        allowOverlay: hasPk && !deleted && isEditableValue(value),
        themeOverride: deleted ? DELETE_THEME : edit ? EDIT_THEME : undefined,
        cursor: isLinkable ? "pointer" : undefined,
      };
    },
    [ordered, rows, insertRows, hasPk, extractPk, edits, deletes, connectionId, table, foreignKeys],
  );

  const onCellEdited = useCallback(
    (cell: Item, newValue: GridCell) => {
      if (newValue.kind !== GridCellKind.Text) return;
      const [col, rowIdx] = cell;
      const columnName = ordered[col];

      if (rowIdx >= rows.length) {
        const insertRow = insertRows[rowIdx - rows.length];
        if (!insertRow) return;
        setInsertValue(insertRow.tempId, { connectionId, table, schema }, columnName, {
          type: "Text",
          value: newValue.data,
        });
        return;
      }

      const row = rows[rowIdx];
      if (!row || !hasPk) return;
      const original = row[columnName];
      const parsed = parseEditedValue(original, newValue.data);
      setEdit({
        connectionId,
        table,
        schema,
        pk: extractPk(row),
        column: columnName,
        oldValue: original ?? { type: "Null" },
        newValue: parsed,
      });
    },
    [ordered, rows, insertRows, hasPk, extractPk, setEdit, setInsertValue, connectionId, table],
  );

  const onCellClicked = useCallback(
    (cell: Item, event: { localEventX: number; bounds: { width: number }; preventDefault: () => void }) => {
      const [col, rowIdx] = cell;
      const columnName = ordered[col];
      const fk = foreignKeys[columnName];
      if (!fk || !onFollowForeignKey || rowIdx >= rows.length) return;

      const value = rows[rowIdx]?.[columnName];
      if (!value || value.type === "Null") return;
      if (event.localEventX < event.bounds.width - FK_HIT_WIDTH) return;

      event.preventDefault();
      onFollowForeignKey(fk, value);
    },
    [ordered, rows, foreignKeys, onFollowForeignKey],
  );

  const onCellContextMenu = useCallback(
    (cell: Item, event: { preventDefault: () => void; bounds: { x: number; y: number } }) => {
      event.preventDefault();
      const [col, rowIdx] = cell;
      setMenuTarget({ col, row: rowIdx });
      setMenuPos({ x: event.bounds.x, y: event.bounds.y });
    },
    [],
  );

  const onHeaderClicked = useCallback(
    (col: number) => onToggleSort?.(ordered[col]),
    [onToggleSort, ordered],
  );

  const menuItems: MenuEntry[] = useMemo(() => {
    if (!menuTarget) return [];
    const { col, row: rowIdx } = menuTarget;
    const columnName = ordered[col];
    const isInsertRow = rowIdx >= rows.length;
    const row = isInsertRow ? undefined : rows[rowIdx];
    const value = row?.[columnName];

    const copy = (text: string) => navigator.clipboard.writeText(text);

    return [
      { label: "Copy cell", disabled: !row, onSelect: () => row && copy(displayValue(value)) },
      {
        label: "Copy row as JSON",
        disabled: !row,
        onSelect: () =>
          row &&
          copy(
            JSON.stringify(
              Object.fromEntries(ordered.map((c) => [c, displayValue(row[c])])),
              null,
              2,
            ),
          ),
      },
      { label: "Copy column name", onSelect: () => copy(columnName) },
      null,
      {
        label: "Set NULL",
        disabled: !row || !hasPk,
        onSelect: () => {
          if (!row || !hasPk) return;
          setEdit({
            connectionId,
            table,
            schema,
            pk: extractPk(row),
            column: columnName,
            oldValue: value ?? { type: "Null" },
            newValue: { type: "Null" },
          });
        },
      },
      null,
      { label: `Sort by ${columnName}`, onSelect: () => onToggleSort?.(columnName) },
      ...(foreignKeys[columnName] && row && value && value.type !== "Null"
        ? [
            null,
            {
              label: `Go to ${foreignKeys[columnName].table}.${foreignKeys[columnName].column}`,
              onSelect: () => onFollowForeignKey?.(foreignKeys[columnName], value),
            },
          ]
        : []),
      null,
      {
        label: isInsertRow ? "Discard new row" : "Mark row for deletion",
        danger: true,
        disabled: !isInsertRow && !hasPk,
        onSelect: () => {
          if (isInsertRow) {
            const ins = insertRows[rowIdx - rows.length];
            if (ins) removeInsert(ins.tempId);
          } else if (row && hasPk) {
            toggleDelete({ connectionId, table, schema }, extractPk(row));
          }
        },
      },
    ];
  }, [
    menuTarget, ordered, rows, insertRows, hasPk, extractPk, setEdit, removeInsert,
    toggleDelete, onToggleSort, connectionId, table, foreignKeys, onFollowForeignKey,
  ]);

  const onKeyDown = useCallback(
    (event: { key: string; preventDefault: () => void }) => {
      if ((event.key === "Delete" || event.key === "Backspace") && hasPk) {
        const selectedRows = selection.rows.toArray();
        if (selectedRows.length === 0) return;
        event.preventDefault();
        for (const rowIdx of selectedRows) {
          if (rowIdx >= rows.length) continue;
          const row = rows[rowIdx];
          toggleDelete({ connectionId, table, schema }, extractPk(row));
        }
      }
    },
    [selection, rows, hasPk, extractPk, toggleDelete, connectionId, table],
  );

  if (columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-neutral-500">No rows.</div>
    );
  }

  return (
    <>
    <DataEditor
      getCellContent={getCellContent}
      onCellEdited={onCellEdited}
      onCellContextMenu={onCellContextMenu}
      onCellClicked={onCellClicked}
      onHeaderClicked={onHeaderClicked}
      columns={gridColumns}
      rows={rows.length + insertRows.length}
      rowMarkers="checkbox"
      cellActivationBehavior="double-click"
      onColumnMoved={onColumnMoved}
      onColumnResize={onColumnResize}
      // Selection must be fully controlled or fully uncontrolled: glide only
      // updates its internal selection when onGridSelectionChange is absent, so
      // supplying the handler without the value leaves selection permanently
      // empty — which silently disables double-click-to-edit.
      gridSelection={selection}
      onGridSelectionChange={(next) => {
        setSelection(next);
        const rowIdx = next.current?.cell[1];
        onActiveRowChange?.(
          rowIdx !== undefined && rowIdx < rows.length ? rows[rowIdx] : null,
        );
      }}
      onKeyDown={onKeyDown}
      theme={darkGridTheme}
      rowHeight={30}
      headerHeight={32}
      smoothScrollX
      smoothScrollY
      width="100%"
      height="100%"
    />
    <ContextMenu position={menuPos} items={menuItems} onClose={() => setMenuPos(null)} />
    </>
  );
}
