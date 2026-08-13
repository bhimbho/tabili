import { useQuery } from "@tanstack/react-query";
import { commands } from "../bindings";

export function useSavedConnections() {
  return useQuery({
    queryKey: ["saved-connections"],
    queryFn: async () => {
      const result = await commands.listSavedConnections();
      if (result.status === "error") throw new Error(result.error.message);
      return result.data;
    },
  });
}
