import { useQuery } from "@tanstack/react-query";
import { commands } from "../bindings";

export function useTables(connectionId: string | null) {
  return useQuery({
    queryKey: ["tables", connectionId],
    queryFn: async () => {
      const result = await commands.listTables(connectionId as string);
      if (result.status === "error") throw new Error(result.error.message);
      return result.data;
    },
    enabled: !!connectionId,
  });
}

export function useColumns(connectionId: string | null, table: string | null) {
  return useQuery({
    queryKey: ["columns", connectionId, table],
    queryFn: async () => {
      const result = await commands.getColumns(connectionId as string, table as string);
      if (result.status === "error") throw new Error(result.error.message);
      return result.data;
    },
    enabled: !!connectionId && !!table,
  });
}

export function useIndexes(connectionId: string | null, table: string | null) {
  return useQuery({
    queryKey: ["indexes", connectionId, table],
    queryFn: async () => {
      const result = await commands.getIndexes(connectionId as string, table as string);
      if (result.status === "error") throw new Error(result.error.message);
      return result.data;
    },
    enabled: !!connectionId && !!table,
  });
}

export function useForeignKeys(connectionId: string | null, table: string | null) {
  return useQuery({
    queryKey: ["foreign-keys", connectionId, table],
    queryFn: async () => {
      const result = await commands.getForeignKeys(connectionId as string, table as string);
      if (result.status === "error") throw new Error(result.error.message);
      return result.data;
    },
    enabled: !!connectionId && !!table,
  });
}
