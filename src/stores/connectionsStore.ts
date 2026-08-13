import { create } from "zustand";

export type Dialect = "Postgres" | "MySql" | "Sqlite";

export interface SavedConnection {
  id: string;
  name: string;
  dialect: Dialect;
  /** Deterministic accent used across sidebar/tabs/status bar to identify this connection at a glance. */
  accentColor: string;
  isConnected: boolean;
}

const ACCENTS = ["#6366f1", "#0ea5e9", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6"];

function accentFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return ACCENTS[hash % ACCENTS.length];
}

interface ConnectionsState {
  connections: SavedConnection[];
  activeConnectionId: string | null;
  setConnections: (conns: Array<Omit<SavedConnection, "accentColor" | "isConnected">>) => void;
  addConnection: (conn: Omit<SavedConnection, "accentColor" | "isConnected">) => void;
  setConnected: (id: string, connected: boolean) => void;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string | null) => void;
}

export const useConnectionsStore = create<ConnectionsState>((set, get) => ({
  connections: [],
  activeConnectionId: null,

  setConnections: (conns) =>
    set((state) => ({
      connections: conns.map((c) => {
        const existing = state.connections.find((e) => e.id === c.id);
        return { ...c, accentColor: accentFor(c.id), isConnected: existing?.isConnected ?? false };
      }),
    })),

  addConnection: (conn) =>
    set((state) => {
      const withoutExisting = state.connections.filter((c) => c.id !== conn.id);
      return {
        connections: [{ ...conn, accentColor: accentFor(conn.id), isConnected: true }, ...withoutExisting],
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
