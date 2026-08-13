import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

export interface MenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** `null` separates groups. */
export type MenuEntry = MenuItem | null;

export interface MenuPosition {
  x: number;
  y: number;
}

interface ContextMenuProps {
  position: MenuPosition | null;
  items: MenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ position, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [adjusted, setAdjusted] = useState<MenuPosition | null>(position);

  useLayoutEffect(() => {
    if (!position) {
      setAdjusted(null);
      return;
    }
    // Flip the menu back inside the window when opened near an edge.
    const el = ref.current;
    if (!el) {
      setAdjusted(position);
      return;
    }
    const { width, height } = el.getBoundingClientRect();
    setAdjusted({
      x: Math.min(position.x, window.innerWidth - width - 8),
      y: Math.min(position.y, window.innerHeight - height - 8),
    });
  }, [position]);

  useEffect(() => {
    if (!position) return;
    const close = () => onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [position, onClose]);

  if (!position) return null;

  return createPortal(
    <div
      ref={ref}
      onMouseDown={(e) => e.stopPropagation()}
      style={{ left: adjusted?.x ?? position.x, top: adjusted?.y ?? position.y }}
      className="fixed z-[10000] min-w-[180px] overflow-hidden rounded-lg border border-neutral-700 bg-neutral-800/95 py-1 shadow-xl shadow-black/50 backdrop-blur-sm"
    >
      {items.map((item, i) =>
        item === null ? (
          <div key={`sep-${i}`} className="my-1 h-px bg-neutral-700" />
        ) : (
          <button
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              item.onSelect();
              onClose();
            }}
            className={`block w-full px-3 py-1 text-left text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
              item.danger
                ? "text-red-400 hover:bg-red-500/20"
                : "text-neutral-200 hover:bg-indigo-600 hover:text-white"
            }`}
          >
            {item.label}
          </button>
        ),
      )}
    </div>,
    document.body,
  );
}

/** Wires an element's right-click to a ContextMenu, handling position state. */
export function useContextMenu() {
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const open = (e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPosition({ x: e.clientX, y: e.clientY });
  };
  return { position, open, close: () => setPosition(null) };
}

export function MenuHost({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
