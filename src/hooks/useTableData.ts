import { useQuery } from "@tanstack/react-query";
import { commands } from "../bindings";

const PAGE_SIZE = 300;

export function useTableRows(connectionId: string | null, table: string | null) {
  return useQuery({
    queryKey: ["rows", connectionId, table],
    queryFn: async () => {
      const result = await commands.fetchRows(connectionId as string, table as string, PAGE_SIZE, 0);
      if (result.status === "error") throw new Error(result.error.message);
      return result.data;
    },
    enabled: !!connectionId && !!table,
  });
}
