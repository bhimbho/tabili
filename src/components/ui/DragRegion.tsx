import { CSSProperties, ReactNode, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface DragRegionProps {
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

/**
 * A window drag handle. The `data-tauri-drag-region` CSS attribute is
 * unreliable on transparent windows, so we drive dragging explicitly via
 * `getCurrentWindow().startDragging()` on mousedown. Children that need to
 * stay clickable (buttons, inputs) should opt out with `data-no-drag`.
 */
export function DragRegion({ className, style, children }: DragRegionProps) {
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    // Don't start a drag when the user is interacting with a control.
    const target = e.target as HTMLElement;
    if (target.closest("[data-no-drag]")) return;
    if (e.button !== 0) return;
    // Prevent the WebView from starting a text selection on mousedown — when
    // the window is already focused that selection drag swallows the gesture
    // and startDragging() never takes over. Unfocusing the window first makes
    // the same click "just work", which is why it only failed while focused.
    e.preventDefault();
    getCurrentWindow().startDragging();
  }, []);

  return (
    <div className={className} style={style} onMouseDown={onMouseDown}>
      {children}
    </div>
  );
}
