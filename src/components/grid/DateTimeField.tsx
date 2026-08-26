import { useState } from "react";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { DbValue } from "../../bindings";

export type DateTimeKind = "date" | "time" | "datetime";

/**
 * Classifies a column's declared type. Returns null for anything that isn't a
 * date/time, which is how the details pane decides to use this editor.
 */
export function dateTimeKind(dataType: string | undefined): DateTimeKind | null {
  if (!dataType) return null;
  const t = dataType.toLowerCase();
  // Checked before "date"/"time" since the names overlap.
  if (t.includes("timestamp") || t.includes("datetime")) return "datetime";
  if (t.startsWith("date")) return "date";
  if (t.startsWith("time")) return "time";
  return null;
}

/** `<input type=...>` wants a specific shape; anything else it silently ignores. */
function toInputValue(text: string, kind: DateTimeKind): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  if (kind === "time") return trimmed.slice(0, 8);
  // Accept both "2026-06-24 02:34:37.662" and ISO "2026-06-24T02:34:37".
  const normalised = trimmed.replace(" ", "T");
  if (kind === "date") return normalised.slice(0, 10);
  // datetime-local takes seconds but not fractional seconds.
  return normalised.slice(0, 19);
}

interface DateTimeFieldProps {
  value: DbValue | undefined;
  kind: DateTimeKind;
  nullable: boolean;
  hasDefault: boolean;
  dirty: boolean;
  disabled?: boolean;
  onChange: (value: DbValue) => void;
}

function label(value: DbValue | undefined): string {
  if (!value || value.type === "Null") return "NULL";
  if (value.type === "Default") return "DEFAULT";
  if (value.type === "Now") return "NOW()";
  if ("value" in value && typeof value.value === "string") return value.value;
  return "";
}

/**
 * Editor for date/time columns. Free text stays the default — it round-trips
 * whatever precision the server sent — with a menu offering the values that are
 * awkward to type: NULL, the column default, server time, and a native picker.
 */
export function DateTimeField({
  value,
  kind,
  nullable,
  hasDefault,
  dirty,
  disabled,
  onChange,
}: DateTimeFieldProps) {
  const [picking, setPicking] = useState(false);
  const text = label(value);
  const isKeyword = !value || ["Null", "Default", "Now"].includes(value.type);

  const fieldBase =
    "selectable w-full rounded-md border bg-(--surface-sunken) px-2 py-1 text-xs text-(--text) outline-none transition-colors";
  const tone = dirty
    ? "border-(--warn) text-(--warn)"
    : "border-(--border) text-(--text)";

  function commitText(next: string) {
    onChange(next === "" ? { type: "Null" } : { type: "DateTime", value: next });
  }

  return (
    <div className="flex gap-1">
      {picking ? (
        <input
          type={kind === "datetime" ? "datetime-local" : kind}
          step={kind === "date" ? undefined : 1}
          defaultValue={isKeyword ? "" : toInputValue(text, kind)}
          disabled={disabled}
          onChange={(e) => commitText(e.target.value.replace("T", " "))}
          onBlur={() => setPicking(false)}
          autoFocus
          className={`${fieldBase} ${tone} flex-1 focus:border-indigo-500`}
        />
      ) : (
        <input
          key={text}
          defaultValue={isKeyword ? "" : text}
          placeholder={isKeyword ? text : undefined}
          disabled={disabled}
          onBlur={(e) => {
            // An untouched keyword field must not be rewritten to empty text.
            if (isKeyword && e.target.value === "") return;
            commitText(e.target.value);
          }}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          className={`${fieldBase} ${tone} flex-1 placeholder:italic placeholder:text-(--text-faint) focus:border-(--accent)`}
        />
      )}

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={disabled}
          title="Value options"
          className="shrink-0 rounded-md border border-(--border) px-1.5 text-(--text-muted) transition-colors hover:border-(--border-strong) hover:bg-(--hover) hover:text-(--text) disabled:opacity-40"
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="h-3 w-3"
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </DropdownMenu.Trigger>

        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            className="z-50 min-w-[150px] overflow-hidden rounded-lg border border-(--border-strong) bg-(--surface-raised) p-1 shadow-xl shadow-black/50"
          >
            {nullable && (
              <DropdownMenu.Item
                onSelect={() => onChange({ type: "Null" })}
                className="cursor-pointer rounded px-2 py-1 text-xs text-(--text) outline-none data-[highlighted]:bg-(--accent) data-[highlighted]:text-(--accent-text)"
              >
                NULL
              </DropdownMenu.Item>
            )}
            {hasDefault && (
              <DropdownMenu.Item
                onSelect={() => onChange({ type: "Default" })}
                className="cursor-pointer rounded px-2 py-1 text-xs text-(--text) outline-none data-[highlighted]:bg-(--accent) data-[highlighted]:text-(--accent-text)"
              >
                DEFAULT
              </DropdownMenu.Item>
            )}
            {(nullable || hasDefault) && (
              <DropdownMenu.Separator className="my-1 h-px bg-(--border)" />
            )}

            <DropdownMenu.Item
              onSelect={() => onChange({ type: "Now" })}
              className="cursor-pointer rounded px-2 py-1 text-xs text-(--text) outline-none data-[highlighted]:bg-(--accent) data-[highlighted]:text-(--accent-text)"
            >
              NOW()
            </DropdownMenu.Item>

            <DropdownMenu.Separator className="my-1 h-px bg-(--border)" />
            <DropdownMenu.Item
              onSelect={() => setPicking(true)}
              className="cursor-pointer rounded px-2 py-1 text-xs text-(--text) outline-none data-[highlighted]:bg-indigo-600 data-[highlighted]:text-white"
            >
              {kind === "time" ? "Time Picker…" : "Date Picker…"}
            </DropdownMenu.Item>
            <DropdownMenu.Item
              onSelect={() => setPicking(false)}
              className="cursor-pointer rounded px-2 py-1 text-xs text-(--text) outline-none data-[highlighted]:bg-indigo-600 data-[highlighted]:text-white"
            >
              Manual input…
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
