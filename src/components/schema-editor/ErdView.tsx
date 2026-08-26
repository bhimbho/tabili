import { useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
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
const PAD = 40;

export function ErdView({ connectionId, schema }: ErdViewProps) {
  const themeMode = useThemeStore((s) => s.mode);
  const { data, isLoading, error } = useQuery({
    queryKey: ["schema-graph", connectionId, schema ?? null],
    queryFn: async () =>
      unwrap(await commands.getSchemaGraph(connectionId, schema ?? null)),
    enabled: !!connectionId,
  });

  const svgRef = useRef<SVGSVGElement | null>(null);

  // Build a node per table and lay them out in a grid.
  const { nodes, edges, width, height } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as { from: string; to: string; label: string }[], width: 0, height: 0 };
    const cols = new Map<string, { name: string; dataType: string; isPrimaryKey: boolean }[]>();
    for (const [table, list] of data.columns) cols.set(table, list);
    const fks = new Map<string, { name: string; columns: string[]; referencedTable: string; referencedColumns: string[] }[]>();
    for (const [table, list] of data.foreignKeys) fks.set(table, list);

    const perRow = Math.max(1, Math.floor(900 / (COL_W + GAP_X)));
    const nodeList: Node[] = data.tables.map((t, i) => {
      const n = cols.get(t.name)?.length ?? 0;
      const w = COL_W;
      const h = HEADER_H + n * ROW_H + 8;
      const x = (i % perRow) * (COL_W + GAP_X);
      const y = Math.floor(i / perRow) * (GAP_Y + 200);
      return { id: t.name, x, y, w, h };
    });

    const edgeList: { from: string; to: string; label: string }[] = [];
    for (const [table, list] of fks) {
      for (const fk of list) {
        edgeList.push({ from: table, to: fk.referencedTable, label: fk.columns.join(", ") });
      }
    }

    const rows = Math.max(1, Math.ceil(nodeList.length / perRow));
    const w = Math.max(600, perRow * (COL_W + GAP_X) - GAP_X + PAD * 2);
    const h = Math.max(400, rows * (GAP_Y + 200) - GAP_Y + PAD * 2);
    return { nodes: nodeList, edges: edgeList, width: w, height: h };
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

  /** Serializes the SVG to a PNG data URL at the given scale. */
  function renderPng(scale = 2): Promise<string> {
    const svg = svgRef.current;
    if (!svg) return Promise.reject(new Error("no svg"));
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("width", String(width * scale));
    clone.setAttribute("height", String(height * scale));
    const xml = new XMLSerializer().serializeToString(clone);
    const svg64 = btoa(unescape(encodeURIComponent(xml)));
    const url = `data:image/svg+xml;base64,${svg64}`;
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width * scale;
        canvas.height = height * scale;
        const ctx = canvas.getContext("2d");
        if (!ctx) return reject(new Error("no canvas"));
        ctx.fillStyle = themeMode === "light" ? "#ffffff" : "#0b0c0e";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve(canvas.toDataURL("image/png"));
      };
      img.onerror = () => reject(new Error("could not render svg"));
      img.src = url;
    });
  }

  async function exportPng() {
    const url = await renderPng(2);
    const a = document.createElement("a");
    a.href = url;
    a.download = "erd.png";
    a.click();
  }

  async function exportPdf() {
    const url = await renderPng(2);
    const img = new Image();
    img.onload = () => {
      const pdf = new jsPDF({ orientation: width > height ? "landscape" : "portrait", unit: "px", format: [width, height] });
      pdf.addImage(url, "PNG", 0, 0, width, height);
      pdf.save("erd.pdf");
    };
    img.src = url;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center gap-2 border-b border-(--border) bg-(--surface-sunken) px-3 py-1.5">
        <span className="text-xs font-medium text-(--text-muted)">
          {nodes.length} table{nodes.length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          <button
            onClick={() => void exportPng()}
            className="rounded-md bg-(--active) px-2.5 py-1 text-xs font-medium text-(--text) transition-colors hover:bg-(--hover)"
          >
            Export PNG
          </button>
          <button
            onClick={() => void exportPdf()}
            className="rounded-md bg-(--accent) px-2.5 py-1 text-xs font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90"
          >
            Export PDF
          </button>
        </div>
      </div>

      {/* Scrollable canvas */}
      <div className="min-h-0 flex-1 overflow-auto bg-(--bg)">
        <svg
          ref={svgRef}
          className="block"
          style={{ width, height, minWidth: "100%", minHeight: "100%" }}
          viewBox={`0 0 ${width} ${height}`}
        >
          <rect x={0} y={0} width={width} height={height} fill={themeMode === "light" ? "#ffffff" : "#0b0c0e"} />
          <g transform={`translate(${PAD}, ${PAD})`}>
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
                  <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={8} fill={surface} stroke={border} strokeWidth={1} />
                  <rect x={n.x} y={n.y} width={n.w} height={HEADER_H} rx={8} fill={headerBg} />
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
    </div>
  );
}
