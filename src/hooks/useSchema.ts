import { useQuery } from "@tanstack/react-query";
import { commands } from "../bindings";

/** `schema` is undefined for SQLite and for Postgres' default (`public`). */
type Schema = string | undefined;

function unwrap<T>(result: { status: "ok"; data: T } | { status: "error"; error: { message: string } }): T {
  if (result.status === "error") throw new Error(result.error.message);
  return result.data;
}

export function useDatabases(connectionId: string | null) {
  return useQuery({
    queryKey: ["databases", connectionId],
    queryFn: async () => unwrap(await commands.listDatabases(connectionId as string)),
    enabled: !!connectionId,
  });
}

export function useSchemas(connectionId: string | null) {
  return useQuery({
    queryKey: ["schemas", connectionId],
    queryFn: async () => unwrap(await commands.listSchemas(connectionId as string)),
    enabled: !!connectionId,
  });
}

export function useTables(connectionId: string | null, schema?: Schema) {
  return useQuery({
    queryKey: ["tables", connectionId, schema ?? null],
    queryFn: async () => unwrap(await commands.listTables(connectionId as string, schema ?? null)),
    enabled: !!connectionId,
  });
}

export function useViews(connectionId: string | null, schema?: Schema) {
  return useQuery({
    queryKey: ["views", connectionId, schema ?? null],
    queryFn: async () => unwrap(await commands.listViews(connectionId as string, schema ?? null)),
    enabled: !!connectionId,
  });
}

export function useColumns(connectionId: string | null, table: string | null, schema?: Schema) {
  return useQuery({
    queryKey: ["columns", connectionId, schema ?? null, table],
    queryFn: async () =>
      unwrap(await commands.getColumns(connectionId as string, schema ?? null, table as string)),
    enabled: !!connectionId && !!table,
  });
}

export function useIndexes(connectionId: string | null, table: string | null, schema?: Schema) {
  return useQuery({
    queryKey: ["indexes", connectionId, schema ?? null, table],
    queryFn: async () =>
      unwrap(await commands.getIndexes(connectionId as string, schema ?? null, table as string)),
    enabled: !!connectionId && !!table,
  });
}

export function useForeignKeys(connectionId: string | null, table: string | null, schema?: Schema) {
  return useQuery({
    queryKey: ["foreign-keys", connectionId, schema ?? null, table],
    queryFn: async () =>
      unwrap(await commands.getForeignKeys(connectionId as string, schema ?? null, table as string)),
    enabled: !!connectionId && !!table,
  });
}

export function useTriggers(connectionId: string | null, table: string | null, schema?: Schema) {
  return useQuery({
    queryKey: ["triggers", connectionId, schema ?? null, table],
    queryFn: async () =>
      unwrap(await commands.getTriggers(connectionId as string, schema ?? null, table as string)),
    enabled: !!connectionId && !!table,
  });
}

export function useTableDdl(connectionId: string | null, table: string | null, schema?: Schema) {
  return useQuery({
    queryKey: ["table-ddl", connectionId, schema ?? null, table],
    queryFn: async () =>
      unwrap(await commands.getTableDdl(connectionId as string, schema ?? null, table as string)),
    enabled: !!connectionId && !!table,
  });
}
