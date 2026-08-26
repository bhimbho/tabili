import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import DataEditor, {
  GridCellKind,
  CompactSelection,
  type DataEditorRef,
  type GridCell,
  type GridColumn,
  type GridSelection,
  type Item,
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import type { ColumnInfo, DbValue } from "../../bindings";
import { useChangesStore, pkKeyOf } from "../../stores/changesStore";
import { ContextMenu, type MenuEntry, type MenuPosition } from "../ui/ContextMenu";
import type { FkMap } from "../../stores/detailsStore";
import { useThemeStore } from "../../stores/themeStore";
import { DELETE_THEME, EDIT_THEME, gridThemeFor, INSERT_THEME } from "./gridTheme";

export type { FkMap } from "../../stores/detailsStore";

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
  onSort?: (column: string, desc: boolean) => void;
  /** Opens a filter row targeting this column, left for the user to fill in. */
  onAddFilter?: (column: string) => void;
  foreignKeys?: FkMap;
  onFollowForeignKey?: (target: { table: string; column: string }, value: DbValue) => void;
  onActiveRowChange?: (row: Record<string, DbValue> | null) => void;
}

function displayValue(value: DbValue | undefined): string {
  if (!value) return "";
  switch (value.type) {
    case "Null":
      return "";
    case "Default":
      return "DEFAULT";
    case "Now":
      return "CURRENT_TIMESTAMP";
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
  onSort,
  onAddFilter,
  foreignKeys = {},
  onFollowForeignKey,
  onActiveRowChange,
}: DataGridProps) {
  const [selection, setSelection] = useState<GridSelection>({
    rows: CompactSelection.empty(),
    columns: CompactSelection.empty(),
  });

  const gridRef = useRef<DataEditorRef>(null);
  // Rows put on an in-app clipboard by Cmd+C. A ref rather than state: nothing
  // renders from it, and the system clipboard can't hold DbValues — round-tripping
  // rows through text would lose their types.
  const rowClipboard = useRef<Record<string, DbValue>[]>([]);

  const [menuPos, setMenuPos] = useState<MenuPosition | null>(null);
  const [menuTarget, setMenuTarget] = useState<
    { kind: "cell" | "header"; col: number; row: number } | null
  >(null);

  const themeMode = useThemeStore((s) => s.mode);
  const gridTheme = gridThemeFor(themeMode);

  const edits = useChangesStore((s) => s.edits);
  const inserts = useChangesStore((s) => s.inserts);
  const deletes = useChangesStore((s) => s.deletes);
  const setEdit = useChangesStore((s) => s.setEdit);
  const setInsertValue = useChangesStore((s) => s.setInsertValue);
  const toggleDelete = useChangesStore((s) => s.toggleDelete);
  const removeInsert = useChangesStore((s) => s.removeInsert);
  const addInsert = useChangesStore((s) => s.addInsert);

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
      // The arrow is painted separately in drawCell so it stays pinned to the
      // right edge instead of being truncated along with a long value.
      const isLinkable = fk !== undefined && shown !== undefined && shown.type !== "Null";

      return {
        kind: GridCellKind.Text,
        data: display,
        displayData: display,
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

  /**
   * Stages copies of `sources` as pending inserts and returns the grid index of
   * the first one.
   *
   * `keepPrimaryKeys` is the difference between the two ways of copying a row.
   * Pasting keeps them, so the duplicate is visible as a duplicate and you fix
   * the key before committing; the Duplicate row command drops them so the
   * server assigns fresh ones.
   */
  const stageCopies = useCallback(
    (sources: Record<string, DbValue>[], keepPrimaryKeys: boolean) => {
      const ctx = { connectionId, table, schema };
      const firstIndex = rows.length + insertRows.length;
      for (const source of sources) {
        const tempId = crypto.randomUUID();
        addInsert(ctx, tempId);
        for (const name of columns) {
          if (!keepPrimaryKeys && pkColumns.includes(name)) continue;
          // NULLs are carried over as NULL rather than left out: a copy should
          // match its source, not pick up whatever default the column has.
          const cell = source[name];
          if (cell !== undefined) setInsertValue(tempId, ctx, name, cell);
        }
      }
      return firstIndex;
    },
    [connectionId, table, schema, rows.length, insertRows.length, columns, pkColumns, addInsert, setInsertValue],
  );

  const drawCell = useCallback(
    (args: {
      ctx: CanvasRenderingContext2D;
      col: number;
      row: number;
      rect: { x: number; y: number; width: number; height: number };
      theme: { bgCell?: string; textLight?: string };
    }, drawContent: () => void) => {
      drawContent();

      const columnName = ordered[args.col];
      if (!foreignKeys[columnName] || args.row >= rows.length) return;
      const value = rows[args.row]?.[columnName];
      if (!value || value.type === "Null") return;

      const { ctx, rect } = args;
      const zoneX = rect.x + rect.width - FK_HIT_WIDTH;
      ctx.save();
      // Cover whatever the value drew underneath so the arrow never collides
      // with truncated text.
      ctx.fillStyle = args.theme.bgCell ?? "#171717";
      ctx.fillRect(zoneX, rect.y + 1, FK_HIT_WIDTH, rect.height - 2);
      ctx.fillStyle = args.theme.textLight ?? "#737373";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("→", zoneX + FK_HIT_WIDTH / 2, rect.y + rect.height / 2);
      ctx.restore();
    },
    [ordered, rows, foreignKeys],
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
      setMenuTarget({ kind: "cell", col, row: rowIdx });
      setMenuPos({ x: event.bounds.x, y: event.bounds.y });
    },
    [],
  );

  const onHeaderContextMenu = useCallback(
    (col: number, event: { preventDefault: () => void; bounds: { x: number; y: number; height: number } }) => {
      event.preventDefault();
      setMenuTarget({ kind: "header", col, row: -1 });
      // Below the header rather than over it, so the column stays visible while
      // you pick an action against it.
      setMenuPos({ x: event.bounds.x, y: event.bounds.y + event.bounds.height });
    },
    [],
  );

  // Clicking a header sorts by it; clicking the column already sorted flips it.
  const toggleSort = useCallback(
    (column: string) => onSort?.(column, column === sortColumn ? !sortDesc : false),
    [onSort, sortColumn, sortDesc],
  );

  const onHeaderClicked = useCallback(
    (col: number) => toggleSort(ordered[col]),
    [toggleSort, ordered],
  );

  const menuItems: MenuEntry[] = useMemo(() => {
    if (!menuTarget) return [];
    const { col, row: rowIdx } = menuTarget;
    const columnName = ordered[col];
    const isInsertRow = rowIdx >= rows.length;
    const row = isInsertRow ? undefined : rows[rowIdx];
    const value = row?.[columnName];

    const copy = (text: string) => navigator.clipboard.writeText(text);

    if (menuTarget.kind === "header") {
      return [
        { label: `Add filter on ${columnName}`, onSelect: () => onAddFilter?.(columnName) },
        null,
        { label: "Sort ascending", onSelect: () => onSort?.(columnName, false) },
        { label: "Sort descending", onSelect: () => onSort?.(columnName, true) },
        null,
        { label: "Copy column name", onSelect: () => copy(columnName) },
      ];
    }

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
        label: "Duplicate row",
        disabled: !row,
        onSelect: () => row && stageCopies([row], false),
      },
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
      { label: `Sort by ${columnName}`, onSelect: () => toggleSort(columnName) },
      { label: `Add filter on ${columnName}`, onSelect: () => onAddFilter?.(columnName) },
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
    stageCopies, schema, toggleSort, onSort, onAddFilter,
    toggleDelete, connectionId, table, foreignKeys, onFollowForeignKey,
  ]);

  const onKeyDown = useCallback(
    (event: {
      key: string;
      metaKey: boolean;
      ctrlKey: boolean;
      preventDefault: () => void;
      cancel: () => void;
    }) => {
      const mod = event.metaKey || event.ctrlKey;
      const range = selection.current?.range;
      // A dragged-out block of cells is a cell copy; a single cell means the row
      // it sits in, since clicking a cell selects its row too.
      const isRange = range !== undefined && (range.width > 1 || range.height > 1);

      if (mod && event.key === "c" && !isRange) {
        const picked = selection.rows
          .toArray()
          .map((i) => (i < rows.length ? rows[i] : insertRows[i - rows.length]?.values))
          .filter((r): r is Record<string, DbValue> => r !== undefined);
        if (picked.length === 0) return;
        // preventDefault stops the browser raising the copy event that glide
        // listens for, so its cell copy doesn't run as well; cancel stops
        // glide's own key handling.
        event.preventDefault();
        event.cancel();
        rowClipboard.current = picked;
        // The clipboard still gets the row as text, for pasting outside the app.
        void navigator.clipboard.writeText(
          picked.map((r) => ordered.map((c) => displayValue(r[c])).join("\t")).join("\n"),
        );
        return;
      }

      // A cell copy replaces whatever row was on the in-app clipboard, so a
      // later paste doesn't resurrect a row copied minutes ago.
      if (mod && event.key === "c" && isRange) {
        rowClipboard.current = [];
        return;
      }

      if (mod && event.key === "v" && rowClipboard.current.length > 0 && !isRange) {
        event.preventDefault();
        event.cancel();
        const firstIndex = stageCopies(rowClipboard.current, true);
        // Land on the primary key of the new row: it is a duplicate of the row
        // it came from until you change it, so that is where you need to be.
        const pkCol = Math.max(0, ordered.indexOf(pkColumns[0] ?? ordered[0]));
        setSelection({
          rows: CompactSelection.fromSingleSelection(firstIndex),
          columns: CompactSelection.empty(),
          current: {
            cell: [pkCol, firstIndex],
            range: { x: pkCol, y: firstIndex, width: 1, height: 1 },
            rangeStack: [],
          },
        });
        // After the render that adds the row — scrolling to a row the grid does
        // not have yet is a no-op.
        requestAnimationFrame(() => gridRef.current?.scrollTo(pkCol, firstIndex));
        return;
      }

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
    [
      selection, rows, insertRows, ordered, pkColumns, stageCopies, hasPk, extractPk,
      toggleDelete, connectionId, table, schema,
    ],
  );

  if (columns.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-(--text-faint)">No rows.</div>
    );
  }

  return (
    <>
    <DataEditor
      ref={gridRef}
      getCellContent={getCellContent}
      onCellEdited={onCellEdited}
      onCellContextMenu={onCellContextMenu}
      onCellClicked={onCellClicked}
      drawCell={drawCell}
      onHeaderClicked={onHeaderClicked}
      onHeaderContextMenu={onHeaderContextMenu}
      columns={gridColumns}
      rows={rows.length + insertRows.length}
      // Numbers rather than checkboxes: the number is still clickable to
      // select, but a row is normally selected just by clicking it (below).
      rowMarkers="clickable-number"
      // Enables Cmd+C over a selected range; glide reads the cells back through
      // getCellContent and puts TSV on the clipboard.
      getCellsForSelection={true}
      // Returning true lets glide split the clipboard by tabs/newlines and feed
      // each cell through onCellEdited, which stages them like any other edit.
      onPaste={(target, values) => {
        // A row copy is served by onKeyDown. If the browser raised the paste
        // event regardless of the prevented default, don't also splice the
        // clipboard text into the cell under the cursor.
        if (rowClipboard.current.length > 0) return false;
        const [, rowIdx] = target;
        // Existing rows need a primary key to be writable; staged inserts don't.
        if (rowIdx < rows.length && !hasPk) return false;
        return values.length > 0;
      }}
      cellActivationBehavior="double-click"
      onColumnMoved={onColumnMoved}
      onColumnResize={onColumnResize}
      // Selection must be fully controlled or fully uncontrolled: glide only
      // updates its internal selection when onGridSelectionChange is absent, so
      // supplying the handler without the value leaves selection permanently
      // empty — which silently disables double-click-to-edit.
      gridSelection={selection}
      onGridSelectionChange={(next) => {
        const rowIdx = next.current?.cell[1];
        // Clicking a cell selects its row too, so row actions have an obvious
        // target without hunting for a checkbox. An existing multi-row
        // selection is left alone so shift/ctrl picking still works.
        const withRow =
          rowIdx !== undefined && !next.rows.hasIndex(rowIdx)
            ? { ...next, rows: CompactSelection.fromSingleSelection(rowIdx) }
            : next;
        setSelection(withRow);
        onActiveRowChange?.(
          rowIdx !== undefined && rowIdx < rows.length ? rows[rowIdx] : null,
        );
      }}
      onKeyDown={onKeyDown}
      theme={gridTheme}
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
