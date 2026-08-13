import type { CSSProperties } from "react";

interface IconProps {
  className?: string;
  style?: CSSProperties;
}

export function DatabaseIcon({ className = "h-4 w-4", style }: IconProps) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6}>
      <ellipse cx="12" cy="5.5" rx="7.25" ry="2.75" />
      <path d="M4.75 5.5v13c0 1.52 3.25 2.75 7.25 2.75s7.25-1.23 7.25-2.75v-13" />
      <path d="M4.75 12c0 1.52 3.25 2.75 7.25 2.75s7.25-1.23 7.25-2.75" />
    </svg>
  );
}

export function ChevronIcon({ className = "h-3 w-3", style }: IconProps) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function TableIcon({ className = "h-3.5 w-3.5", style }: IconProps) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.3}>
      <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="1.5" />
      <path d="M1.75 6.25h12.5M6.25 6.25v7" />
    </svg>
  );
}

export function ViewIcon({ className = "h-3.5 w-3.5", style }: IconProps) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.3}>
      <path d="M1.5 8s2.4-4.25 6.5-4.25S14.5 8 14.5 8s-2.4 4.25-6.5 4.25S1.5 8 1.5 8Z" />
      <circle cx="8" cy="8" r="1.75" />
    </svg>
  );
}

export function FunctionIcon({ className = "h-3.5 w-3.5", style }: IconProps) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.3}>
      <path d="M6.5 13V5.5A2 2 0 018.5 3.5h.75" strokeLinecap="round" />
      <path d="M4.75 7.25h4.5" strokeLinecap="round" />
      <path d="M11 9.5l2.5 3.5M13.5 9.5L11 13" strokeLinecap="round" />
    </svg>
  );
}

export function KeyIcon({ className = "h-3 w-3", style }: IconProps) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={1.4}>
      <circle cx="5.5" cy="10.5" r="2.75" />
      <path d="M7.5 8.5 13 3m-2 2 1.5 1.5M9.5 6.5 11 8" />
    </svg>
  );
}

export function ReloadIcon({ className = "h-3.5 w-3.5", style }: IconProps) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M16.023 9.348h4.992V4.356M20.015 9.348a8.25 8.25 0 10-1.98 8.457"
      />
    </svg>
  );
}

export function PanelIcon({ className = "h-3.5 w-3.5", style }: IconProps) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M9 4.5v15" />
    </svg>
  );
}

export function PanelRightIcon({ className = "h-3.5 w-3.5", style }: IconProps) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.7}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <path d="M15 4.5v15" />
    </svg>
  );
}

export function PlusIcon({ className = "h-3.5 w-3.5", style }: IconProps) {
  return (
    <svg className={className} style={style} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </svg>
  );
}
