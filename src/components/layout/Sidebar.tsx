import { NewConnectionDialog } from "../connection/NewConnectionDialog";
import { ConnectionRail } from "../connection/ConnectionRail";
import { ObjectPanel } from "../connection/ObjectPanel";
import { Resizer } from "../ui/Resizer";
import { useLayoutStore } from "../../stores/layoutStore";
import { useDialogsStore } from "../../stores/dialogsStore";

export function Sidebar() {
  // Held in a store rather than local state so File ▸ Open… can reach it too.
  const dialogOpen = useDialogsStore((s) => s.dialog === "new-connection");
  const openDialog = useDialogsStore((s) => s.open);
  const closeDialog = useDialogsStore((s) => s.close);
  const setDialogOpen = (open: boolean) => (open ? openDialog("new-connection") : closeDialog());
  const { sidebarWidth, sidebarVisible, setSidebarWidth } = useLayoutStore();

  if (!sidebarVisible) {
    return <NewConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} />;
  }

  return (
    <>
      <aside
        style={{ width: sidebarWidth }}
        className="surface-gradient flex shrink-0 border-r border-black/50 bg-neutral-900/30 text-neutral-300"
      >
        <ConnectionRail onNewConnection={() => setDialogOpen(true)} />
        <ObjectPanel />
        <NewConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} />
      </aside>
      <Resizer width={sidebarWidth} onResize={setSidebarWidth} side="left" min={220} max={560} />
    </>
  );
}
