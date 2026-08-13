import { useQuery } from "@tanstack/react-query";
import { commands } from "../bindings";
import type { ColumnFilter } from "../bindings";

const PAGE_SIZE = 500;

export interface TableQuery {
  filters: ColumnFilter[];
  orderBy: string | null;
  orderDesc: boolean;
}

export const EMPTY_QUERY: TableQuery = { filters: [], orderBy: null, orderDesc: false };

export function useTableRows(
  connectionId: string | null,
  table: string | null,
  query: TableQuery = EMPTY_QUERY,
) {
  return useQuery({
    queryKey: ["rows", connectionId, table, query],
    queryFn: async () => {
      const result = await commands.fetchRows(
        connectionId as string,
        table as string,
        PAGE_SIZE,
        0,
        query.orderBy,
        query.orderDesc,
        query.filters,
      );
      if (result.status === "error") throw new Error(result.error.message);
      return result.data;
    },
    enabled: !!connectionId && !!table,
    placeholderData: (prev) => prev,
  });
}
