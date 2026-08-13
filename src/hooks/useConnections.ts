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

export function useServerInfo(connectionId: string | null) {
  return useQuery({
    queryKey: ["server-info", connectionId],
    queryFn: async () => {
      const result = await commands.serverInfo(connectionId as string);
      if (result.status === "error") throw new Error(result.error.message);
      return result.data;
    },
    enabled: !!connectionId,
    staleTime: 5 * 60_000,
  });
}

export function useStatementLog() {
  return useQuery({
    queryKey: ["statement-log"],
    queryFn: async () => {
      const result = await commands.listStatementLog(200);
      if (result.status === "error") throw new Error(result.error.message);
      return result.data;
    },
  });
}

export function useSavedQueries() {
  return useQuery({
    queryKey: ["saved-queries"],
    queryFn: async () => {
      const result = await commands.listSavedQueries();
      if (result.status === "error") throw new Error(result.error.message);
      return result.data;
    },
  });
}
