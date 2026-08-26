import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { commands, type DbGrant, type DbUser } from "../../bindings";
import { friendlyError } from "../../lib/errors";
import { useConnectionsStore } from "../../stores/connectionsStore";
import { useConsoleStore } from "../../stores/consoleStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";

interface UserManagementProps {
  connectionId: string;
}

function unwrap<T>(result: { status: "ok"; data: T } | { status: "error"; error: { message: string } }): T {
  if (result.status === "error") throw new Error(result.error.message);
  return result.data;
}

const PRIVILEGES = [
  "SELECT",
  "INSERT",
  "UPDATE",
  "DELETE",
  "TRUNCATE",
  "REFERENCES",
  "TRIGGER",
  "CREATE",
  "CONNECT",
  "USAGE",
  "ALL",
];

function userKey(u: DbUser): string {
  return `${u.name}@${u.host ?? ""}`;
}

export function UserManagement({ connectionId }: UserManagementProps) {
  const queryClient = useQueryClient();
  const log = useConsoleStore((s) => s.log);
  const dialect = useConnectionsStore((s) => s.connections.find((c) => c.id === connectionId)?.dialect);

  const usersQuery = useQuery({
    queryKey: ["users", connectionId],
    queryFn: async () => unwrap(await commands.listUsers(connectionId)),
    enabled: !!connectionId,
  });

  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<DbUser | null>(null);

  const selectedUser = usersQuery.data?.find((u) => userKey(u) === selectedKey) ?? null;

  const grantsQuery = useQuery({
    queryKey: ["user-grants", connectionId, selectedKey],
    queryFn: async () =>
      unwrap(await commands.userGrants(connectionId, selectedUser!.name, selectedUser!.host)),
    enabled: !!selectedUser,
  });

  const refreshUsers = () => queryClient.invalidateQueries({ queryKey: ["users", connectionId] });
  const refreshGrants = () => queryClient.invalidateQueries({ queryKey: ["user-grants", connectionId] });

  const createUser = useMutation({
    mutationFn: async (p: { name: string; password: string; superuser: boolean }) =>
      unwrap(await commands.createUser(connectionId, { ...p, host: null })),
    onSuccess: () => {
      void refreshUsers();
      setCreating(false);
    },
    onError: (e: unknown) =>
      log({ sql: "Create User", success: false, error: friendlyError(e instanceof Error ? e.message : String(e)), durationMs: 0 }),
  });

  const dropUser = useMutation({
    mutationFn: async (u: DbUser) => unwrap(await commands.dropUser(connectionId, u.name, u.host)),
    onSuccess: () => {
      void refreshUsers();
      setSelectedKey(null);
      setDeleting(null);
    },
    onError: (e: unknown) =>
      log({ sql: "Drop User", success: false, error: friendlyError(e instanceof Error ? e.message : String(e)), durationMs: 0 }),
  });

  const grant = useMutation({
    mutationFn: async (g: { privilege: string; schema: string | null; table: string | null }) =>
      unwrap(await commands.grantPrivilege(connectionId, selectedUser!.name, selectedUser!.host, g.privilege, g.schema, g.table)),
    onSuccess: refreshGrants,
    onError: (e: unknown) =>
      log({ sql: "Grant", success: false, error: friendlyError(e instanceof Error ? e.message : String(e)), durationMs: 0 }),
  });

  const revoke = useMutation({
    mutationFn: async (g: DbGrant) =>
      unwrap(await commands.revokePrivilege(connectionId, selectedUser!.name, selectedUser!.host, g.privilege, g.schema, g.table)),
    onSuccess: refreshGrants,
    onError: (e: unknown) =>
      log({ sql: "Revoke", success: false, error: friendlyError(e instanceof Error ? e.message : String(e)), durationMs: 0 }),
  });

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <header className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-(--text)">User Management</h2>
        <div className="flex items-center gap-2">
          <span className="text-xs text-(--text-muted)">{dialect ?? "Unknown"} connection</span>
          <button
            onClick={() => void usersQuery.refetch()}
            className="rounded-md border border-(--border) px-2.5 py-1 text-xs text-(--text-muted) transition-colors hover:text-(--text)"
          >
            Refresh
          </button>
        </div>
      </header>

      {usersQuery.isLoading ? (
        <p className="text-sm text-(--text-muted)">Loading users…</p>
      ) : usersQuery.error ? (
        <p className="text-sm text-(--danger)">{(usersQuery.error as Error).message}</p>
      ) : (
        <div className="flex min-h-0 flex-1 gap-3">
          {/* User list */}
          <div className="flex w-64 shrink-0 flex-col rounded-lg border border-(--border) bg-(--surface-sunken)">
            <div className="flex items-center justify-between border-b border-(--border) px-3 py-2">
              <span className="text-xs font-medium text-(--text-muted)">Users</span>
              <button
                onClick={() => setCreating(true)}
                className="rounded-md bg-(--accent) px-2 py-0.5 text-xs font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90"
              >
                + New
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {usersQuery.data?.map((u) => (
                <button
                  key={userKey(u)}
                  onClick={() => setSelectedKey(userKey(u))}
                  className={`flex w-full flex-col items-start px-3 py-2 text-left text-sm transition-colors ${
                    selectedKey === userKey(u)
                      ? "bg-(--accent)/15 text-(--text)"
                      : "text-(--text-muted) hover:bg-(--surface-sunken-2)"
                  }`}
                >
                  <span className="text-(--text)">{u.name}</span>
                  <span className="text-xs text-(--text-faint)">
                    {u.host ?? "any"} · {u.superuser ? "superuser" : "user"}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Details */}
          <div className="min-w-0 flex-1 overflow-y-auto rounded-md border border-(--border) bg-(--surface-sunken)">
            {!selectedUser ? (
              <div className="flex h-full items-center justify-center text-sm text-(--text-faint)">
                Select a user to view details
              </div>
            ) : (
              <div className="flex h-full flex-col">
                <div className="border-b border-(--border) p-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-(--text)">{selectedUser.name}</h3>
                    <button
                      onClick={() => setDeleting(selectedUser)}
                      className="rounded-md border border-(--danger)/40 px-2.5 py-1 text-xs text-(--danger) transition-colors hover:bg-(--danger)/10"
                    >
                      Drop
                    </button>
                  </div>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
                    <Attribute label="Host" value={selectedUser.host ?? "any"} />
                    <Attribute label="Login" value={selectedUser.canLogin ? "yes" : "no"} />
                    <Attribute label="Superuser" value={selectedUser.superuser ? "yes" : "no"} />
                    <Attribute label="Create DB" value={selectedUser.canCreateDb ? "yes" : "no"} />
                    <Attribute label="Create Role" value={selectedUser.canCreateRole ? "yes" : "no"} />
                  </dl>
                </div>

                <div className="flex flex-1 flex-col p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-(--text-muted)">Grants</span>
                    <GrantForm onGrant={grant.mutate} />
                  </div>
                  {grantsQuery.isLoading ? (
                    <p className="mt-2 text-xs text-(--text-muted)">Loading grants…</p>
                  ) : grantsQuery.error ? (
                    <p className="mt-2 text-xs text-(--danger)">{(grantsQuery.error as Error).message}</p>
                  ) : (grantsQuery.data?.length ?? 0) === 0 ? (
                    <p className="mt-2 text-xs text-(--text-faint)">No grants yet.</p>
                  ) : (
                    <table className="mt-2 w-full text-left text-xs">
                      <thead>
                        <tr className="text-(--text-faint)">
                          <th className="py-1 pr-2 font-medium">Privilege</th>
                          <th className="py-1 pr-2 font-medium">Schema</th>
                          <th className="py-1 pr-2 font-medium">Table</th>
                          <th className="py-1 font-medium"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {grantsQuery.data?.map((g, i) => (
                          <tr key={i} className="border-t border-(--border)">
                            <td className="py-1 pr-2 font-medium text-(--text)">{g.privilege}</td>
                            <td className="py-1 pr-2 text-(--text-muted)">{g.schema ?? "—"}</td>
                            <td className="py-1 pr-2 text-(--text-muted)">{g.table ?? "—"}</td>
                            <td className="py-1 text-right">
                              <button
                                onClick={() => revoke.mutate(g)}
                                className="text-xs text-(--text-faint) transition-colors hover:text-(--danger)"
                              >
                                Revoke
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {creating && <CreateUserDialog onClose={() => setCreating(false)} onCreate={(p) => createUser.mutate(p)} />}

      {deleting && (
        <ConfirmDialog
          open
          danger
          title="Drop user"
          description={`Drop user "${deleting.name}"? This cannot be undone.`}
          confirmLabel="Drop"
          onConfirm={() => dropUser.mutate(deleting)}
          onCancel={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function Attribute({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded bg-(--surface-sunken-2) px-2 py-1">
      <dt className="text-(--text-faint)">{label}</dt>
      <dd className="text-(--text)">{value}</dd>
    </div>
  );
}

function GrantForm({ onGrant }: { onGrant: (g: { privilege: string; schema: string | null; table: string | null }) => void }) {
  const [privilege, setPrivilege] = useState(PRIVILEGES[0]);
  const [schema, setSchema] = useState("");
  const [table, setTable] = useState("");

  const submit = () => {
    onGrant({ privilege, schema: schema || null, table: table || null });
    setSchema("");
    setTable("");
  };

  return (
    <div className="flex items-center gap-1">
      <select
        value={privilege}
        onChange={(e) => setPrivilege(e.target.value)}
        className="rounded-md border border-(--border) bg-(--surface-sunken) px-1.5 py-0.5 text-xs text-(--text) outline-none"
      >
        {PRIVILEGES.map((p) => (
          <option key={p} value={p}>{p}</option>
        ))}
      </select>
      <input
        value={schema}
        onChange={(e) => setSchema(e.target.value)}
        placeholder="schema"
        className="w-24 rounded-md border border-(--border) bg-(--surface-sunken) px-1.5 py-0.5 text-xs text-(--text) placeholder:text-(--text-faint) outline-none"
      />
      <input
        value={table}
        onChange={(e) => setTable(e.target.value)}
        placeholder="table"
        className="w-24 rounded-md border border-(--border) bg-(--surface-sunken) px-1.5 py-0.5 text-xs text-(--text) placeholder:text-(--text-faint) outline-none"
      />
      <button
        onClick={submit}
        className="rounded-md bg-(--accent) px-2 py-0.5 text-xs font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90"
      >
        Grant
      </button>
    </div>
  );
}

function CreateUserDialog({ onCreate, onClose }: { onCreate: (p: { name: string; password: string; superuser: boolean }) => void; onClose: () => void }) {
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [superuser, setSuperuser] = useState(false);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-(--bg)/50 backdrop-blur-[2px]">
      <div className="dialog-content w-[360px] rounded-xl border border-(--border) bg-(--surface-raised) p-5 shadow-xl shadow-black/40">
        <h3 className="text-base font-semibold text-(--text)">New User</h3>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-(--text-muted)">
            Username
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="rounded-md border border-(--border) bg-(--surface-sunken) px-2.5 py-1.5 text-sm text-(--text) outline-none focus:border-(--accent)"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-(--text-muted)">
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-md border border-(--border) bg-(--surface-sunken) px-2.5 py-1.5 text-sm text-(--text) outline-none focus:border-(--accent)"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-(--text-muted)">
            <input
              type="checkbox"
              checked={superuser}
              onChange={(e) => setSuperuser(e.target.checked)}
              className="h-3.5 w-3.5 accent-(--accent)"
            />
            Superuser (may create databases and roles)
          </label>
        </div>
        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md px-3 py-1.5 text-sm text-(--text-muted) transition-colors hover:text-(--text)"
          >
            Cancel
          </button>
          <button
            onClick={() => onCreate({ name, password, superuser })}
            disabled={!name.trim()}
            className="rounded-md bg-(--accent) px-4 py-1.5 text-sm font-medium text-(--accent-text) transition-colors hover:bg-(--accent)/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}
