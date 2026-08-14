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

/**
 * Doubles as the connection heartbeat: it is the cheapest round trip to the
 * server, so failing it is how a dropped connection gets noticed. Without the
 * poll a link killed by the far end still looks connected until the next query,
 * and the reconnect affordances stay disabled.
 */
export function useServerInfo(connectionId: string | null) {
  return useQuery({
    queryKey: ["server-info", connectionId],
    queryFn: async () => {
      const result = await commands.serverInfo(connectionId as string);
      if (result.status === "error") throw new Error(result.error.message);
      return result.data;
    },
    enabled: !!connectionId,
    staleTime: 20_000,
    refetchInterval: 30_000,
    // One retry so a single blip doesn't declare the connection dead.
    retry: 1,
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
