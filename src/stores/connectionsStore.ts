import { create } from "zustand";

export type Dialect = "Postgres" | "MySql" | "Sqlite";

export interface SavedConnection {
  id: string;
  name: string;
  dialect: Dialect;
  color: string | null;
  /** Deterministic accent used across sidebar/tabs/status bar to identify this connection at a glance. */
  accentColor: string;
  isConnected: boolean;
}

/** Offered in the connection dialog; red conventionally marks production. */
export const CONNECTION_COLORS = [
  { value: "#6366f1", label: "Indigo" },
  { value: "#0ea5e9", label: "Blue" },
  { value: "#10b981", label: "Green" },
  { value: "#f59e0b", label: "Amber" },
  { value: "#a855f7", label: "Purple" },
  { value: "#6b7280", label: "Grey" },
  { value: "#ef4444", label: "Red — production" },
];

const FALLBACK = "#6366f1";

function accentFor(id: string, color?: string | null): string {
  if (color) return color;
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CONNECTION_COLORS[hash % (CONNECTION_COLORS.length - 1)]?.value ?? FALLBACK;
}

interface ConnectionsState {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  /** Selected schema per connection; undefined means the driver default. */
  activeSchema: Record<string, string>;
  setConnections: (conns: Array<Omit<SavedConnection, "accentColor" | "isConnected">>) => void;
  addConnection: (conn: Omit<SavedConnection, "accentColor" | "isConnected">) => void;
  setConnected: (id: string, connected: boolean) => void;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string | null) => void;
  setActiveSchema: (connectionId: string, schema: string) => void;
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  activeConnectionId: null,
  activeSchema: {},

  setActiveSchema: (connectionId, schema) =>
    set((state) => ({ activeSchema: { ...state.activeSchema, [connectionId]: schema } })),

  setConnections: (conns) =>
    set((state) => ({
      connections: conns.map((c) => {
        const existing = state.connections.find((e) => e.id === c.id);
        return {
          ...c,
          accentColor: accentFor(c.id, c.color),
          isConnected: existing?.isConnected ?? false,
        };
      }),
    })),

  addConnection: (conn) =>
    set((state) => {
      const withoutExisting = state.connections.filter((c) => c.id !== conn.id);
      return {
        connections: [
          { ...conn, accentColor: accentFor(conn.id, conn.color), isConnected: true },
          ...withoutExisting,
        ],
        activeConnectionId: conn.id,
      };
    }),

  setConnected: (id, connected) =>
    set((state) => ({
      connections: state.connections.map((c) => (c.id === id ? { ...c, isConnected: connected } : c)),
      activeConnectionId: connected ? id : state.activeConnectionId,
    })),

  removeConnection: (id) =>
    set((state) => ({
      connections: state.connections.filter((c) => c.id !== id),
      activeConnectionId: get().activeConnectionId === id ? null : get().activeConnectionId,
    })),

  setActiveConnection: (id) => set({ activeConnectionId: id }),
}));
