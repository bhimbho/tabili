import { useCallback, useEffect, useRef } from "react";

interface ResizerProps {
  /** Current width in px. */
  width: number;
  onResize: (width: number) => void;
  min?: number;
  max?: number;
  /** "left" grows the pane as you drag right (pane is on the left edge). */
  side: "left" | "right";
}

/**
 * A 4px drag strip between panes. Pointer capture keeps the drag alive even when
 * the cursor outruns the handle, which is easy to do on a thin target.
 */
export function Resizer({ width, onResize, min = 180, max = 640, side }: ResizerProps) {
  const startX = useRef(0);
  const startWidth = useRef(0);
  const dragging = useRef(false);

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      if (!dragging.current) return;
      const delta = e.clientX - startX.current;
      const next = side === "left" ? startWidth.current + delta : startWidth.current - delta;
      onResize(Math.min(max, Math.max(min, next)));
    },
    [onResize, min, max, side],
  );

  const onPointerUp = useCallback(() => {
    dragging.current = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }, []);

  useEffect(() => {
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [onPointerMove, onPointerUp]);

  return (
    <div
      onPointerDown={(e) => {
        dragging.current = true;
        startX.current = e.clientX;
        startWidth.current = width;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onDoubleClick={() => onResize(side === "left" ? 300 : 300)}
      className="group relative w-1 shrink-0 cursor-col-resize bg-transparent"
      title="Drag to resize · double-click to reset"
    >
      <div className="absolute inset-y-0 left-0 w-px bg-(--border-strong) transition-colors group-hover:bg-indigo-500" />
    </div>
  );
}
