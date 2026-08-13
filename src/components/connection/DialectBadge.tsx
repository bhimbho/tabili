import clsx from "clsx";
import type { Dialect } from "../../stores/connectionsStore";

const STYLES: Record<Dialect, { label: string; bg: string }> = {
  Postgres: { label: "PG", bg: "bg-sky-600" },
  MySql: { label: "My", bg: "bg-amber-600" },
  Sqlite: { label: "Sq", bg: "bg-emerald-600" },
};

interface DialectBadgeProps {
  dialect: Dialect;
  size?: "sm" | "md" | "lg";
}

export function DialectBadge({ dialect, size = "md" }: DialectBadgeProps) {
  const { label, bg } = STYLES[dialect];
  const sizeClasses =
    size === "lg" ? "h-11 w-11 text-sm" : size === "sm" ? "h-5 w-5 text-[9px]" : "h-8 w-8 text-xs";

  return (
    <span
      className={clsx(
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white",
        bg,
        sizeClasses,
      )}
    >
      {label}
    </span>
  );
}
