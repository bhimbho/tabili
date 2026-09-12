import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import { commands } from "../../bindings";
import { useThemeStore } from "../../stores/themeStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";
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

interface Edge {
  from: string;
  to: string;
  label: string;
}

const MIN_W = 200;
const MAX_W = 360;
const ROW_H = 20;
const HEADER_H = 30;
const GAP_X = 80;
const GAP_Y = 60;
const PAD = 40;
const TEXT_PAD = 10;
/** Space kept between a column name and its right-aligned data type. */
const NAME_TYPE_GAP = 14;
/** Width the layout tries to stay within before wrapping to a new row. */
const TARGET_W = 1400;
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';

/**
 * Measures text with the same font the SVG renders in, so box widths are based
 * on what will actually be drawn rather than a guessed character count.
 */
const measureText = (() => {
  let ctx: CanvasRenderingContext2D | null = null;
  return (label: string, size: number, weight = 400) => {
    ctx ??= document.createElement("canvas").getContext("2d");
    if (!ctx) return label.length * size * 0.6;
    ctx.font = `${weight} ${size}px ${FONT}`;
    return ctx.measureText(label).width;
  };
})();

/** Shortens a label with an ellipsis until it fits within `max` pixels. */
function truncate(label: string, size: number, weight: number, max: number) {
  if (measureText(label, size, weight) <= max) return label;
  let lo = 0;
  let hi = label.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (measureText(label.slice(0, mid) + "…", size, weight) <= max) lo = mid;
    else hi = mid - 1;
  }
  return label.slice(0, lo) + "…";
}

export function ErdView({ connectionId, schema }: ErdViewProps) {
  const themeMode = useThemeStore((s) => s.mode);
  const [isExporting, setIsExporting] = useState<"png" | "pdf" | null>(null);
  const [pendingExport, setPendingExport] = useState<"png" | "pdf" | null>(null);
  const [viewState, setViewState] = useState({ scale: 1, x: 0, y: 0 });
  const isDragging = useRef(false);
  const lastMousePos = useRef({ x: 0, y: 0 });

  const { data, isLoading, error } = useQuery({
    queryKey: ["schema-graph", connectionId, schema ?? null],
    queryFn: async () =>
      unwrap(await commands.getSchemaGraph(connectionId, schema ?? null)),
    enabled: !!connectionId,
  });

  const svgRef = useRef<SVGSVGElement | null>(null);

  const handleWheel = () => {
    // Mouse wheel zoom disabled per request
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    isDragging.current = true;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging.current) return;
    const dx = e.clientX - lastMousePos.current.x;
    const dy = e.clientY - lastMousePos.current.y;
    lastMousePos.current = { x: e.clientX, y: e.clientY };
    setViewState((prev) => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy,
    }));
  };

  const handleMouseUp = () => {
    isDragging.current = false;
  };

  const zoomIn = () => setViewState(prev => ({ ...prev, scale: Math.min(prev.scale + 0.1, 3) }));
  const zoomOut = () => setViewState(prev => ({ ...prev, scale: Math.max(prev.scale - 0.1, 0.1) }));

  // Build a node per table, size each box to its contents, then pack the boxes
  // into columns so that tall tables never run into the row below them.
  const { nodes, edges, width, height } = useMemo(() => {
    if (!data) return { nodes: [] as Node[], edges: [] as Edge[], width: 0, height: 0 };
    const cols = new Map<string, { name: string; dataType: string; isPrimaryKey: boolean }[]>();
    for (const [table, list] of data.columns) cols.set(table, list);
    const fks = new Map<string, { name: string; columns: string[]; referencedTable: string; referencedColumns: string[] }[]>();
    for (const [table, list] of data.foreignKeys) fks.set(table, list);

    // One shared width keeps the grid tidy; it is driven by the widest row in
    // any table so names and types stop colliding.
    let contentW = MIN_W;
    for (const t of data.tables) {
      contentW = Math.max(contentW, measureText(t.name, 12, 600) + TEXT_PAD * 2);
      for (const c of cols.get(t.name) ?? []) {
        const nameW = measureText((c.isPrimaryKey ? "🔑 " : "") + c.name, 11, c.isPrimaryKey ? 600 : 400);
        const typeW = measureText(c.dataType, 10);
        contentW = Math.max(contentW, nameW + NAME_TYPE_GAP + typeW + TEXT_PAD * 2);
      }
    }
    const boxW = Math.min(MAX_W, Math.ceil(contentW));

    const perRow = Math.max(1, Math.floor((TARGET_W + GAP_X) / (boxW + GAP_X)));
    // Next free y per column: each table drops into the shortest column, which
    // both removes the overlaps and evens out the vertical whitespace.
    const columnBottoms = new Array<number>(perRow).fill(0);
    const nodeList: Node[] = data.tables.map((t) => {
      const n = cols.get(t.name)?.length ?? 0;
      const h = HEADER_H + n * ROW_H + 8;
      let col = 0;
      for (let i = 1; i < perRow; i++) if (columnBottoms[i] < columnBottoms[col]) col = i;
      const y = columnBottoms[col];
      columnBottoms[col] = y + h + GAP_Y;
      return { id: t.name, x: col * (boxW + GAP_X), y, w: boxW, h };
    });

    const edgeList: Edge[] = [];
    for (const [table, list] of fks) {
      for (const fk of list) {
        edgeList.push({ from: table, to: fk.referencedTable, label: fk.columns.join(", ") });
      }
    }

    const usedCols = Math.min(perRow, Math.max(1, nodeList.length));
    const w = Math.max(600, usedCols * (boxW + GAP_X) - GAP_X + PAD * 2);
    const tallest = columnBottoms.reduce((a, b) => Math.max(a, b), 0);
    const h = Math.max(400, tallest - GAP_Y + PAD * 2);
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
  // Index of each edge among the edges sharing its endpoints, used to fan out
  // the labels of parallel relationships.
  const labelRank = new Map<string, Map<number, number>>();
  edges.forEach((e, i) => {
    const key = `${e.from}\u0000${e.to}`;
    const group = labelRank.get(key) ?? new Map<number, number>();
    group.set(i, group.size);
    labelRank.set(key, group);
  });
  const cols = new Map<string, { name: string; dataType: string; isPrimaryKey: boolean }[]>();
  for (const [table, list] of data.columns) cols.set(table, list);

  const accent = themeMode === "light" ? "#4f46e5" : "#6366f1";
  const border = themeMode === "light" ? "rgba(0,0,0,0.12)" : "rgba(255,255,255,0.12)";
  const text = themeMode === "light" ? "#18181b" : "#f4f4f5";
  const muted = themeMode === "light" ? "#71717a" : "#a1a1aa";
  const surface = themeMode === "light" ? "#ffffff" : "#1c1d20";
  const headerBg = themeMode === "light" ? "#f0f0f2" : "#202023";
  const canvasBg = themeMode === "light" ? "#ffffff" : "#0b0c0e";

  /**
   * Rasterizes the diagram SVG onto a canvas.
   *
   * This has to happen on the main thread: `createImageBitmap` refuses SVG
   * blobs in a worker (WKWebView has no SVG decoder outside the DOM), so the
   * only portable path is an <img> loading a self-contained data URL.
   */
  async function renderCanvas(scale = 2): Promise<HTMLCanvasElement> {
    const svg = svgRef.current;
    if (!svg) throw new Error("no svg");

    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("xmlns:xlink", "http://www.w3.org/1999/xlink");
    clone.setAttribute("width", String(width));
    clone.setAttribute("height", String(height));
    clone.setAttribute("viewBox", `0 0 ${width} ${height}`);
    // Drop anything that only resolves against the app's stylesheet.
    clone.removeAttribute("class");
    clone.removeAttribute("style");

    const xml = new XMLSerializer().serializeToString(clone);
    // A data URL keeps the image same-origin, so the canvas stays untainted.
    const dataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(xml);

    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("could not rasterize the diagram"));
      img.src = dataUrl;
    });

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("could not get a 2D context");

    ctx.fillStyle = canvasBg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  async function exportPng() {
    setIsExporting("png");
    try {
      const canvas = await renderCanvas(2);
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("PNG encoding failed"))), "image/png"),
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "erd.png";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error("Export PNG failed:", e);
      alert("Failed to export PNG: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsExporting(null);
    }
  }

  async function exportPdf() {
    setIsExporting("pdf");
    try {
      const canvas = await renderCanvas(2);
      // jsPDF needs the pixels inline — it cannot read a blob: URL.
      const dataUrl = canvas.toDataURL("image/png");
      const pdf = new jsPDF({
        orientation: width > height ? "landscape" : "portrait",
        unit: "px",
        format: [width, height],
      });
      pdf.addImage(dataUrl, "PNG", 0, 0, width, height);
      pdf.save("erd.pdf");
    } catch (e) {
      console.error("Export PDF failed:", e);
      alert("Failed to export PDF: " + (e instanceof Error ? e.message : String(e)));
    } finally {
      setIsExporting(null);
    }
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
            onClick={zoomOut}
            className="rounded-md bg-(--surface-sunken) border border-(--border) px-2 py-1 text-xs font-medium text-(--text) hover:bg-(--hover)"
          >
            −
          </button>
          <button
            onClick={zoomIn}
            className="rounded-md bg-(--surface-sunken) border border-(--border) px-2 py-1 text-xs font-medium text-(--text) hover:bg-(--hover)"
          >
            +
          </button>
          <div className="w-px h-4 bg-(--border) mx-1" />
          <button
            onClick={() => setPendingExport("png")}
            disabled={isExporting !== null}
            className="rounded-md bg-(--active) px-2.5 py-1 text-xs font-medium text-(--text) transition-colors hover:bg-(--hover) disabled:opacity-50"
          >
            {isExporting === "png" ? "Exporting..." : "Export PNG"}
          </button>
          <button
            onClick={() => setPendingExport("pdf")}
            disabled={isExporting !== null}
            className="rounded-md bg-(--accent) px-2.5 py-1 text-xs font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:opacity-50"
          >
            {isExporting === "pdf" ? "Exporting..." : "Export PDF"}
          </button>
        </div>
      </div>

      {/* Scrollable canvas */}
      <div 
        className="min-h-0 flex-1 overflow-auto bg-(--bg)"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div 
          style={{ 
            transform: `translate(${viewState.x}px, ${viewState.y}px) scale(${viewState.scale})`,
            transformOrigin: "0 0",
            transition: isDragging.current ? "none" : "transform 0.1s ease-out"
          }}
        >
          <svg
            ref={svgRef}
            className="block"
            style={{ width, height }}
            viewBox={`0 0 ${width} ${height}`}
            // Declared on the SVG so exports and text measurement agree.
            fontFamily={FONT}
          >
            <defs>
              {/* Standard Arrowhead */}
              <marker
                id="arrow"
                viewBox="0 0 10 10"
                refX="10"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 10 5 L 0 10 z" fill={accent} />
              </marker>
              {/* Crow's Foot (Many) */}
              <marker
                id="crowfoot"
                viewBox="0 0 10 10"
                refX="10"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto-start-reverse"
              >
                <path d="M 10 5 L 4 2 M 10 5 L 4 8" stroke={accent} strokeWidth="1.2" fill="none" />
                <path d="M 10 5 L 6 5" stroke={accent} strokeWidth="1.2" fill="none" />
              </marker>
            </defs>
            <rect x={0} y={0} width={width} height={height} fill={canvasBg} />
            <g transform={`translate(${PAD}, ${PAD})`}>
              {/* Relationship lines */}
              {edges.map((e, i) => {
                const a = nodeById.get(e.from);
                const b = nodeById.get(e.to);
                if (!a || !b) return null;

                if (a === b) {
                  // Self-reference: a small loop off the right edge.
                  const x = a.x + a.w;
                  const y = a.y + a.h / 2;
                  return (
                    <g key={i}>
                      <path
                        d={`M ${x} ${y - 10} C ${x + 34} ${y - 10}, ${x + 34} ${y + 10}, ${x} ${y + 10}`}
                        fill="none"
                        stroke={accent}
                        strokeWidth={1.2}
                        opacity={0.6}
                      />
                    </g>
                  );
                }

                // Leave from the side that faces the target so the line does
                // not cut back across its own box.
                const leftToRight = b.x + b.w / 2 >= a.x + a.w / 2;
                const ax = leftToRight ? a.x + a.w : a.x;
                const bx = leftToRight ? b.x : b.x + b.w;
                const ay = a.y + a.h / 2;
                const by = b.y + b.h / 2;
                const bend = Math.max(40, Math.abs(bx - ax) / 2);
                const c1 = leftToRight ? ax + bend : ax - bend;
                const c2 = leftToRight ? bx - bend : bx + bend;

                // Parallel edges between the same pair share a midpoint, so
                // stagger their labels instead of stacking them.
                const rank = labelRank.get(`${e.from}\u0000${e.to}`) ?? new Map();
                const offset = (rank.get(i) ?? 0) * 13;
                const lx = (ax + bx) / 2;
                const ly = (ay + by) / 2 - 4 + offset;
                const lw = measureText(e.label, 9) + 6;

                return (
                  <g key={i}>
                    <path
                      d={`M ${ax} ${ay} C ${c1} ${ay}, ${c2} ${by}, ${bx} ${by}`}
                      fill="none"
                      stroke={accent}
                      strokeWidth={1.2}
                      opacity={0.6}
                    />
                    {/* A plate behind the label keeps it readable over the lines. */}
                    <rect x={lx - lw / 2} y={ly - 9} width={lw} height={12} rx={3} fill={canvasBg} opacity={0.85} />
                    <text x={lx} y={ly} textAnchor="middle" fontSize={9} fill={muted}>
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
                    <text x={n.x + TEXT_PAD} y={n.y + 19} fontSize={12} fontWeight={600} fill={text}>
                      {truncate(n.id, 12, 600, n.w - TEXT_PAD * 2)}
                    </text>
                    {list.map((c, j) => {
                      const label = (c.isPrimaryKey ? "🔑 " : "") + c.name;
                      const weight = c.isPrimaryKey ? 600 : 400;
                      const typeW = measureText(c.dataType, 10);
                      const nameMax = n.w - TEXT_PAD * 2 - typeW - NAME_TYPE_GAP;
                      const baseline = n.y + HEADER_H + 16 + j * ROW_H;
                      return (
                        <g key={c.name}>
                          <text
                            x={n.x + TEXT_PAD}
                            y={baseline}
                            fontSize={11}
                            fill={c.isPrimaryKey ? accent : text}
                            fontWeight={weight}
                          >
                            {truncate(label, 11, weight, nameMax)}
                          </text>
                          <text
                            x={n.x + n.w - TEXT_PAD}
                            y={baseline}
                            fontSize={10}
                            fill={muted}
                            textAnchor="end"
                          >
                            {c.dataType}
                          </text>
                        </g>
                      );
                    })}
                  </g>
                );
              })}
            </g>
          </svg>
        </div>
      </div>

      <ConfirmDialog
        open={pendingExport !== null}
        title={pendingExport === "pdf" ? "Export diagram as PDF?" : "Export diagram as PNG?"}
        description={`This saves all ${nodes.length} table${nodes.length === 1 ? "" : "s"} to erd.${pendingExport ?? "png"} in your downloads folder.`}
        confirmLabel="Export"
        onConfirm={() => {
          const kind = pendingExport;
          setPendingExport(null);
          if (kind === "pdf") void exportPdf();
          else if (kind === "png") void exportPng();
        }}
        onCancel={() => setPendingExport(null)}
      />
    </div>
  );
}
