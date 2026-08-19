import { useQuery } from "@tanstack/react-query";
import { commands } from "../bindings";
import { useConsoleStore } from "../stores/consoleStore";
import type { ColumnFilter } from "../bindings";

export const PAGE_SIZE = 500;

export interface TableQuery {
  filters: ColumnFilter[];
  orderBy: string | null;
  orderDesc: boolean;
}

export const EMPTY_QUERY: TableQuery = { filters: [], orderBy: null, orderDesc: false };

/** `page` is zero-based; the backend reports `hasMore` so the last page is known. */
export function useTableRows(
  connectionId: string | null,
  table: string | null,
  schema?: string | null,
  query: TableQuery = EMPTY_QUERY,
  page = 0,
) {
  return useQuery({
    queryKey: ["rows", connectionId, schema ?? null, table, query, page],
    queryFn: async () => {
      const result = await commands.fetchRows(
        connectionId as string,
        schema ?? null,
        table as string,
        PAGE_SIZE,
        page * PAGE_SIZE,
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
