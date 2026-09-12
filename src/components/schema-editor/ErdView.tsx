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

const COL_W = 200;
const ROW_H = 20;
const HEADER_H = 30;
const GAP_X = 60;
const GAP_Y = 40;
const PAD = 40;

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

    ctx.fillStyle = themeMode === "light" ? "#ffffff" : "#0b0c0e";
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
        className="min-h-0 flex-1 overflow-hidden bg-(--bg)"
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
