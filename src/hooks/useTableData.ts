import { useQuery } from "@tanstack/react-query";
import { commands } from "../bindings";
import { useConsoleStore } from "../stores/consoleStore";
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
  schema?: string | null,
  query: TableQuery = EMPTY_QUERY,
) {
  return useQuery({
    queryKey: ["rows", connectionId, schema ?? null, table, query],
    queryFn: async () => {
      const result = await commands.fetchRows(
        connectionId as string,
        schema ?? null,
        table as string,
        PAGE_SIZE,
        0,
        query.orderBy,
        query.orderDesc,
        query.filters,
      );
      if (result.status === "error") {
        useConsoleStore.getState().log({
          sql: `SELECT * FROM ${table}`,
          success: false,
          error: result.error.message,
        });
        throw new Error(result.error.message);
      }
      // The backend reports the statement it actually sent, so the console shows
      // the real query rather than a reconstruction.
      useConsoleStore.getState().log({ sql: result.data.sql, success: true });
      return result.data;
    },
    enabled: !!connectionId && !!table,
    placeholderData: (prev) => prev,
  });
}
