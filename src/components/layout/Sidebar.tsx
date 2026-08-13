import { useState } from "react";
import { NewConnectionDialog } from "../connection/NewConnectionDialog";
import { ConnectionRail } from "../connection/ConnectionRail";
import { ObjectPanel } from "../connection/ObjectPanel";

export function Sidebar() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <aside className="flex w-[300px] shrink-0 border-r border-black/30 bg-neutral-900/40 text-neutral-300">
      <ConnectionRail onNewConnection={() => setDialogOpen(true)} />
      <ObjectPanel />
      <NewConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </aside>
  );
}
