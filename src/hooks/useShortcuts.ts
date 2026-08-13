import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { commitChanges } from "../lib/commitChanges";
import { useChangesStore } from "../stores/changesStore";
import { useConsoleStore } from "../stores/consoleStore";

/**
 * ⌘S commits staged changes straight away — no confirmation dialog, per the
 * usual meaning of Save. The review dialog stays available for when you do want
 * to inspect the SQL first.
 */
export function useShortcuts() {
  const queryClient = useQueryClient();

  useEffect(() => {
    async function onKey(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === "s") {
        e.preventDefault();
        if (useChangesStore.getState().count() === 0) return;
        const errors = await commitChanges(queryClient);
        if (errors.length > 0) {
          // commitChanges already logged the detail; the console auto-opens on failure.
          useConsoleStore.getState().setOpen(true);
        }
      }

      if (e.key === "j") {
        e.preventDefault();
        useConsoleStore.getState().toggle();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [queryClient]);
}
