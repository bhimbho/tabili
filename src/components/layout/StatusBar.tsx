interface StatusBarProps {
  appVersion?: string;
}

export function StatusBar({ appVersion }: StatusBarProps) {
  return (
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-neutral-800 bg-neutral-950 px-3 text-xs text-neutral-500">
      <span>No active connection</span>
      <span>{appVersion ? `tabili v${appVersion}` : "tabili"}</span>
    </footer>
  );
}
