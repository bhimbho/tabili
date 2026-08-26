import * as Dialog from "@radix-ui/react-dialog";
import { DialogCloseButton } from "./DialogCloseButton";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = "Cancel",
  danger,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => !next && onCancel()}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-(--bg)/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 w-[420px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-(--border) bg-(--surface-raised) p-5 shadow-xl shadow-black/40 focus:outline-none">
          <DialogCloseButton onClose={onCancel} />
          <Dialog.Title className="text-base font-semibold text-(--text)">{title}</Dialog.Title>
          <Dialog.Description className="mt-1.5 text-sm text-(--text-muted)">
            {description}
          </Dialog.Description>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              onClick={onCancel}
              className="rounded-md px-3 py-1.5 text-sm text-(--text-muted) transition-colors hover:text-(--text)"
            >
              {cancelLabel}
            </button>
            <button
              onClick={onConfirm}
              className={`rounded-md px-4 py-1.5 text-sm font-medium text-(--accent-text) transition-colors ${
                danger ? "bg-(--danger) hover:bg-(--danger)/90" : "bg-(--accent) hover:bg-(--accent)/90"
              }`}
            >
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
