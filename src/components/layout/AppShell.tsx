import { ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { StatusBar } from "./StatusBar";
import { TopBar } from "./TopBar";
import { ConsolePanel } from "./ConsolePanel";

interface AppShellProps {
  appVersion?: string;
  children?: ReactNode;
}

export function AppShell({ appVersion, children }: AppShellProps) {
  return (
    <div className="flex h-screen w-screen flex-col text-neutral-100">
      <div className="flex min-h-0 flex-1">
        <Sidebar />
        <div className="flex min-w-0 flex-1 flex-col bg-neutral-900">
          <TopBar />
          <TabBar />
          <main className="min-h-0 flex-1 overflow-auto">{children}</main>
          <ConsolePanel />
          <StatusBar appVersion={appVersion} />
        </div>
      </div>
    </div>
  );
}
