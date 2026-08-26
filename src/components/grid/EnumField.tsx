import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import type { DbValue } from "../../bindings";

interface EnumFieldProps {
  value: DbValue | undefined;
  options: string[];
  nullable: boolean;
  /** Shows a DEFAULT entry only when the column actually declares one. */
  hasDefault: boolean;
  dirty: boolean;
  disabled?: boolean;
  onChange: (value: DbValue) => void;
}

function label(value: DbValue | undefined): string {
  if (!value || value.type === "Null") return "NULL";
  if (value.type === "Default") return "DEFAULT";
  if (value.type === "Text") return value.value;
  return String("value" in value ? value.value : "");
}

/**
 * A picker for columns whose type is an enumeration, rather than the free-text
 * field every other column gets — the allowed labels are known, so typing one
 * by hand only invites a constraint violation.
 */
export function EnumField({
  value,
  options,
  nullable,
  hasDefault,
  dirty,
  disabled,
  onChange,
}: EnumFieldProps) {
  const isPlaceholder = !value || value.type === "Null";
  const current = label(value);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        disabled={disabled}
        className={`selectable flex w-full items-center justify-between gap-1 rounded-md border px-2 py-1 text-left text-xs outline-none transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          dirty
            ? "border-amber-700/60 bg-amber-950/20 text-amber-300"
            : "border-(--border) bg-(--surface-sunken) text-(--text)"
        } hover:border-(--border-strong) focus:border-(--accent)`}
      >
        <span className={isPlaceholder ? "italic text-(--text-faint)" : undefined}>{current}</span>
        {/* Double chevron marks this as a value picker, not a free-text field. */}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-3 w-3 shrink-0 text-(--text-faint)"
        >
          <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />
        </svg>
      </DropdownMenu.Trigger>

      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={4}
          className="z-50 min-w-[var(--radix-dropdown-menu-trigger-width)] overflow-hidden rounded-lg border border-(--border-strong) bg-(--surface-raised) p-1 shadow-xl shadow-black/50"
        >
          {options.map((option) => (
            <DropdownMenu.Item
              key={option}
              onSelect={() => onChange({ type: "Text", value: option })}
              className={`cursor-pointer rounded px-2 py-1 text-xs outline-none transition-colors data-[highlighted]:bg-(--accent) data-[highlighted]:text-(--accent-text) ${
                current === option ? "text-(--accent)" : "text-(--text)"
              }`}
            >
              {option}
            </DropdownMenu.Item>
          ))}

          {(nullable || hasDefault) && (
            <DropdownMenu.Separator className="my-1 h-px bg-(--border)" />
          )}
          {nullable && (
            <DropdownMenu.Item
              onSelect={() => onChange({ type: "Null" })}
              className="cursor-pointer rounded px-2 py-1 text-xs text-(--text-muted) outline-none transition-colors data-[highlighted]:bg-(--accent) data-[highlighted]:text-(--accent-text)"
            >
              NULL
            </DropdownMenu.Item>
          )}
          {hasDefault && (
            <DropdownMenu.Item
              onSelect={() => onChange({ type: "Default" })}
              className="cursor-pointer rounded px-2 py-1 text-xs text-(--text-muted) outline-none transition-colors data-[highlighted]:bg-(--accent) data-[highlighted]:text-(--accent-text)"
            >
              DEFAULT
            </DropdownMenu.Item>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
