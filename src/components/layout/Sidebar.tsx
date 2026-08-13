import { useState } from "react";
import { NewConnectionDialog } from "../connection/NewConnectionDialog";
import { ConnectionRail } from "../connection/ConnectionRail";
import { ObjectPanel } from "../connection/ObjectPanel";
import { Resizer } from "../ui/Resizer";
import { useLayoutStore } from "../../stores/layoutStore";

export function Sidebar() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const { sidebarWidth, sidebarVisible, setSidebarWidth } = useLayoutStore();

  if (!sidebarVisible) {
    return <NewConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} />;
  }

  return (
    <>
      <aside
        style={{ width: sidebarWidth }}
        className="flex shrink-0 border-r border-black/30 bg-neutral-900/40 text-neutral-300"
      >
        <ConnectionRail onNewConnection={() => setDialogOpen(true)} />
        <ObjectPanel />
        <NewConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </aside>
      <Resizer width={sidebarWidth} onResize={setSidebarWidth} side="left" min={220} max={560} />
    </>
  );
}
