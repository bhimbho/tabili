import * as Dialog from "@radix-ui/react-dialog";
import { XIcon } from "./icons";

interface DialogCloseButtonProps {
  onClose: () => void;
}

/**
 * The standard "×" close affordance for dialogs, pinned to the top-right
 * corner. Radix dialogs are dismissible via overlay click / Escape, but a
 * visible close button is expected in a desktop app.
 */
export function DialogCloseButton({ onClose }: DialogCloseButtonProps) {
  return (
    <Dialog.Close asChild onClick={onClose}>
      <button
        aria-label="Close"
        title="Close"
        className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-md text-(--text-faint) transition-colors hover:bg-(--hover) hover:text-(--text)"
      >
        <XIcon className="h-3.5 w-3.5" />
      </button>
    </Dialog.Close>
  );
}
