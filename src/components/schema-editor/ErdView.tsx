import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { useThemeStore } from "../../stores/themeStore";

interface ErdViewProps {
  connectionId: string;
  schema: string | null;
}

function unwrap<T>(result: { status: "ok"; data: T } | { status: "error"; error: { message: string } }): T {
  if (result.status === "error") throw new Error(result.error.message);
  return result.data;
}

/** A table's box on the canvas. */
interface Node {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

const COL_W = 200;
const ROW_H = 20;
const HEADER_H = 30;
const GAP_X = 60;
const GAP_Y = 40;

export function ErdView({ connectionId, schema }: ErdViewProps) {
  const themeMode = useThemeStore((s) => s.mode);
  const { data, isLoading, error } = useQuery({
    queryKey: ["schema-graph", connectionId, schema ?? null],
    queryFn: async () =>
      unwrap(await commands.getSchemaGraph(connectionId, schema ?? null)),
    enabled: !!connectionId,
  });

  const [offset, setOffset] = useState({ x: 40, y: 40 });
  const [drag, setDrag] = useState<{ startX: number; startY: number; ox: number; oy: number } | null>(null);

  // Build a node per table and lay them out in a grid.
  const { nodes, edges } = useMemo(() => {
    if (!data) return { nodes: [], edges: [] as { from: string; to: string; label: string }[] };
    const cols = new Map<string, { name: string; dataType: string; isPrimaryKey: boolean }[]>();
    for (const [table, list] of data.columns) cols.set(table, list);
    const fks = new Map<string, { name: string; columns: string[]; referencedTable: string; referencedColumns: string[] }[]>();
    for (const [table, list] of data.foreignKeys) fks.set(table, list);

    const nodeList: Node[] = data.tables.map((t, i) => {
      const n = cols.get(t.name)?.length ?? 0;
      const w = COL_W;
      const h = HEADER_H + n * ROW_H + 8;
      const perRow = Math.max(1, Math.floor(900 / (COL_W + GAP_X)));
      const x = (i % perRow) * (COL_W + GAP_X);
      const y = Math.floor(i / perRow) * (GAP_Y + 200);
      return { id: t.name, x, y, w, h };
    });

    const edgeList: { from: string; to: string; label: string }[] = [];
    for (const [table, list] of fks) {
      for (const fk of list) {
        edgeList.push({
          from: table,
          to: fk.referencedTable,
          label: fk.columns.join(", "),
        });
      }
    }
    return { nodes: nodeList, edges: edgeList };
  }, [data]);

  if (isLoading) {
    return <div className="flex h-full items-center justify-center text-sm text-(--text-faint)">Loading schema…</div>;
  }
  if (error) {
    return <div className="flex h-full items-center justify-center text-sm text-(--danger)">{String(error)}</div>;
  }
  if (!data || nodes.length === 0) {
    return <div className="flex h-full items-center justify-center text-sm text-(--text-faint)">No tables to show.</div>;
  }

  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const cols = new Map<string, { name: string; dataType: string; isPrimaryKey: boolean }[]>();
  for (const [table, list] of data.columns) cols.set(table, list);

  const accent = themeMode === "light" ? "#4f46e5" : "#6366f1";
  const border = themeMode === "light" ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)";
  const text = themeMode === "light" ? "#18181b" : "#f4f4f5";
  const muted = themeMode === "light" ? "#71717a" : "#a1a1aa";
  const surface = themeMode === "light" ? "#ffffff" : "#1c1d20";
  const headerBg = themeMode === "light" ? "#f0f0f2" : "#202023";

  return (
    <div
      className="relative h-full w-full overflow-hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          setDrag({ startX: e.clientX, startY: e.clientY, ox: offset.x, oy: offset.y });
        }
      }}
      onMouseMove={(e) => {
        if (drag) {
          setOffset({ x: drag.ox + (e.clientX - drag.startX), y: drag.oy + (e.clientY - drag.startY) });
        }
      }}
      onMouseUp={() => setDrag(null)}
      onMouseLeave={() => setDrag(null)}
    >
      <svg
        className="absolute inset-0"
        style={{ cursor: drag ? "grabbing" : "grab" }}
        width="100%"
        height="100%"
      >
        <g transform={`translate(${offset.x}, ${offset.y})`}>
          {/* Relationship lines */}
          {edges.map((e, i) => {
            const a = nodeById.get(e.from);
            const b = nodeById.get(e.to);
            if (!a || !b) return null;
            const ax = a.x + a.w;
            const ay = a.y + a.h / 2;
            const bx = b.x;
            const by = b.y + b.h / 2;
            const mid = (ax + bx) / 2;
            return (
              <g key={i}>
                <path
                  d={`M ${ax} ${ay} C ${mid} ${ay}, ${mid} ${by}, ${bx} ${by}`}
                  fill="none"
                  stroke={accent}
                  strokeWidth={1.2}
                  opacity={0.6}
                />
                <text x={mid} y={(ay + by) / 2 - 4} textAnchor="middle" fontSize={9} fill={muted}>
                  {e.label}
                </text>
              </g>
            );
          })}

          {/* Table boxes */}
          {nodes.map((n) => {
            const list = cols.get(n.id) ?? [];
            return (
              <g key={n.id}>
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={n.h}
                  rx={8}
                  fill={surface}
                  stroke={border}
                  strokeWidth={1}
                />
                <rect
                  x={n.x}
                  y={n.y}
                  width={n.w}
                  height={HEADER_H}
                  rx={8}
                  fill={headerBg}
                />
                <rect x={n.x} y={n.y + HEADER_H - 8} width={n.w} height={8} fill={headerBg} />
                <text x={n.x + 10} y={n.y + 19} fontSize={12} fontWeight={600} fill={text}>
                  {n.id}
                </text>
                {list.map((c, j) => (
                  <g key={c.name}>
                    <text
                      x={n.x + 10}
                      y={n.y + HEADER_H + 16 + j * ROW_H}
                      fontSize={11}
                      fill={c.isPrimaryKey ? accent : text}
                      fontWeight={c.isPrimaryKey ? 600 : 400}
                    >
                      {c.isPrimaryKey ? "🔑 " : ""}
                      {c.name}
                    </text>
                    <text
                      x={n.x + n.w - 10}
                      y={n.y + HEADER_H + 16 + j * ROW_H}
                      fontSize={10}
                      fill={muted}
                      textAnchor="end"
                    >
                      {c.dataType}
                    </text>
                  </g>
                ))}
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
