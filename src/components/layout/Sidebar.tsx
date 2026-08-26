import { NewConnectionDialog } from "../connection/NewConnectionDialog";
import { ConnectionRail } from "../connection/ConnectionRail";
import { ObjectPanel } from "../connection/ObjectPanel";
import { Resizer } from "../ui/Resizer";
import { useLayoutStore } from "../../stores/layoutStore";
import { useDialogsStore } from "../../stores/dialogsStore";
import { useSavedConnections } from "../../hooks/useConnections";

export function Sidebar() {
  // Held in a store rather than local state so File ▸ Open… can reach it too.
  const dialog = useDialogsStore((s) => s.dialog);
  const editingId = useDialogsStore((s) => s.editingConnectionId);
  const openDialog = useDialogsStore((s) => s.open);
  const closeDialog = useDialogsStore((s) => s.close);
  const { data: saved } = useSavedConnections();

  const dialogOpen = dialog === "new-connection" || dialog === "edit-connection";
  const editing = dialog === "edit-connection"
    ? (saved?.find((c) => c.id === editingId) ?? null)
    : null;
  const setDialogOpen = (open: boolean) => (open ? openDialog("new-connection") : closeDialog());
  const { sidebarWidth, sidebarVisible, setSidebarWidth } = useLayoutStore();

  if (!sidebarVisible) {
    return <NewConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />;
  }

  return (
    <>
      <aside
        style={{ width: sidebarWidth }}
        className="flex shrink-0 border-r border-(--border-strong) bg-(--surface) text-(--text-muted)"
      >
        <ConnectionRail onNewConnection={() => setDialogOpen(true)} />
        <ObjectPanel />
        <NewConnectionDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} />
      </aside>
      <Resizer width={sidebarWidth} onResize={setSidebarWidth} side="left" min={220} max={560} />
    </>
  );
}
