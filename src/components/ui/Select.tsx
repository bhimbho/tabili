import * as RadixSelect from "@radix-ui/react-select";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** "sm" is the dense variant used in toolbars and the filter bar. */
  size?: "sm" | "md";
}

export function Select({ value, onChange, options, placeholder, size = "md" }: SelectProps) {
  const trigger =
    size === "sm"
      ? "rounded-md px-2 py-0.5 text-xs"
      : "rounded-lg px-3 py-1.5 text-sm";
  return (
    <RadixSelect.Root value={value} onValueChange={onChange}>
      <RadixSelect.Trigger
        className={`flex w-full items-center justify-between gap-1 border border-neutral-800 bg-neutral-950 text-neutral-100 outline-none transition-colors data-[placeholder]:text-neutral-600 hover:border-neutral-700 focus:border-indigo-500 ${trigger}`}
      >
        <span className="truncate"><RadixSelect.Value placeholder={placeholder} /></span>
        <RadixSelect.Icon>
          <svg className="h-3 w-3 shrink-0 text-neutral-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15M8.25 9L12 5.25 15.75 9" />
          </svg>
        </RadixSelect.Icon>
      </RadixSelect.Trigger>
      <RadixSelect.Portal>
        <RadixSelect.Content
          position="popper"
          sideOffset={4}
          className="select-content z-[10001] max-h-[300px] overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900 text-xs shadow-xl shadow-black/50"
        >
          <RadixSelect.Viewport className="p-1">
            {options.map((opt) => (
              <RadixSelect.Item
                key={opt.value}
                value={opt.value}
                className="relative flex cursor-pointer select-none items-center rounded-md py-1.5 pl-7 pr-3 text-neutral-200 outline-none transition-colors data-[highlighted]:bg-indigo-600 data-[highlighted]:text-white"
              >
                <RadixSelect.ItemIndicator className="absolute left-2 inline-flex items-center">
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                </RadixSelect.ItemIndicator>
                <RadixSelect.ItemText>{opt.label}</RadixSelect.ItemText>
              </RadixSelect.Item>
            ))}
          </RadixSelect.Viewport>
        </RadixSelect.Content>
      </RadixSelect.Portal>
    </RadixSelect.Root>
  );
}
