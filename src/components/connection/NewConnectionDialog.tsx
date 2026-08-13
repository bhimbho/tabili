import { useEffect, useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { homeDir, join } from "@tauri-apps/api/path";
import { useQueryClient } from "@tanstack/react-query";
import { commands, type SavedConnectionRecord } from "../../bindings";
import { useConnectionsStore, CONNECTION_COLORS, type Dialect } from "../../stores/connectionsStore";
import { DialectBadge } from "./DialectBadge";
import { Select } from "../ui/Select";
import { friendlyError } from "../../lib/errors";

const SSL_MODES = [
  { value: "disable", label: "Disable" },
  { value: "allow", label: "Allow" },
  { value: "prefer", label: "Prefer" },
  { value: "require", label: "Require" },
  { value: "verify-ca", label: "Verify CA" },
  { value: "verify-full", label: "Verify Full" },
];

interface DialectMeta {
  key: Dialect;
  label: string;
  defaultPort?: number;
}

const DIALECTS: DialectMeta[] = [
  { key: "Postgres", label: "PostgreSQL", defaultPort: 5432 },
  { key: "MySql", label: "MySQL", defaultPort: 3306 },
  { key: "Sqlite", label: "SQLite" },
];

interface NewConnectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present to edit an existing connection instead of creating one. */
  editing?: SavedConnectionRecord | null;
}

type Step = "pick" | "configure";

const inputClass =
  "w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-sm text-neutral-100 outline-none transition-colors placeholder:text-neutral-600 focus:border-indigo-500";

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="mb-1 block text-xs font-medium text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function CertButton({ label, set, onPick }: { label: string; set: string; onPick: () => void }) {
  return (
    <button
      type="button"
      onClick={onPick}
      title={set || undefined}
      className={`truncate rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${
        set
          ? "border-indigo-800 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-950/70"
          : "border-neutral-800 bg-neutral-950 text-neutral-400 hover:bg-neutral-800"
      }`}
    >
      {set ? set.split("/").pop() : label}
    </button>
  );
}

export function NewConnectionDialog({ open, onOpenChange, editing }: NewConnectionDialogProps) {
  const addConnection = useConnectionsStore((s) => s.addConnection);
  const queryClient = useQueryClient();
  const isEditing = !!editing;
  const [step, setStep] = useState<Step>("pick");
  const [dialect, setDialect] = useState<Dialect | null>(null);
  const [name, setName] = useState("");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [color, setColor] = useState<string>(CONNECTION_COLORS[0].value);
  const [sslMode, setSslMode] = useState("prefer");
  const [sslKeyPath, setSslKeyPath] = useState("");
  const [sslCertPath, setSslCertPath] = useState("");
  const [sslCaPath, setSslCaPath] = useState("");
  const [filePath, setFilePath] = useState("");
  const [sshEnabled, setSshEnabled] = useState(false);
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUsername, setSshUsername] = useState("");
  const [sshPassword, setSshPassword] = useState("");
  const [sshUseKey, setSshUseKey] = useState(false);
  const [sshPrivateKeyPath, setSshPrivateKeyPath] = useState("");
  const [sshPrivateKeyPassphrase, setSshPrivateKeyPassphrase] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setStep("pick");
    setDialect(null);
    setName("");
    setHost("127.0.0.1");
    setPort("");
    setUsername("");
    setPassword("");
    setDatabase("");
    setColor(CONNECTION_COLORS[0].value);
    setSslMode("prefer");
    setSslKeyPath("");
    setSslCertPath("");
    setSslCaPath("");
    setFilePath("");
    setSshEnabled(false);
    setSshHost("");
    setSshPort("22");
    setSshUsername("");
    setSshPassword("");
    setSshUseKey(false);
    setSshPrivateKeyPath("");
    setSshPrivateKeyPassphrase("");
    setConnecting(false);
    setError(null);
  }

  // Load the saved values when editing. Secrets are deliberately left blank —
  // they live in the Keychain and are never read back into the form; leaving a
  // field empty on save keeps whatever is already stored.
  useEffect(() => {
    if (!open || !editing) return;
    setStep("configure");
    setDialect(editing.dialect);
    setName(editing.name);
    setHost(editing.host ?? "127.0.0.1");
    setPort(editing.port != null ? String(editing.port) : "");
    setUsername(editing.username ?? "");
    setPassword("");
    setDatabase(editing.database ?? "");
    setColor(editing.color ?? CONNECTION_COLORS[0].value);
    setSslMode(editing.sslMode ?? "prefer");
    setSslKeyPath(editing.sslKeyPath ?? "");
    setSslCertPath(editing.sslCertPath ?? "");
    setSslCaPath(editing.sslCaPath ?? "");
    setFilePath(editing.filePath ?? "");
    setSshEnabled(editing.sshEnabled);
    setSshHost(editing.sshHost ?? "");
    setSshPort(editing.sshPort != null ? String(editing.sshPort) : "22");
    setSshUsername(editing.sshUsername ?? "");
    setSshPassword("");
    setSshUseKey(editing.sshUseKey);
    setSshPrivateKeyPath(editing.sshPrivateKeyPath ?? "");
    setSshPrivateKeyPassphrase("");
    setError(null);
  }, [open, editing]);

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function selectDialect(meta: DialectMeta) {
    setDialect(meta.key);
    setPort(meta.defaultPort ? String(meta.defaultPort) : "");
    setStep("configure");
  }

  async function pickFile() {
    const path = await openFileDialog({
      multiple: false,
      directory: false,
      filters: [
        { name: "SQLite database", extensions: ["sqlite", "sqlite3", "db"] },
        // A SQLite file needn't be named with any of those extensions.
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!path || Array.isArray(path)) return;
    setFilePath(path);
    if (!name) setName(path.split("/").pop() ?? path);
  }

  async function pickCertFile(setter: (path: string) => void) {
    const path = await openFileDialog({
      multiple: false,
      directory: false,
      filters: [
        { name: "Certificate / Key", extensions: ["pem", "crt", "cer", "key", "p12", "pfx"] },
        // Certificates don't always carry a conventional extension.
        { name: "All files", extensions: ["*"] },
      ],
    });
    if (!path || Array.isArray(path)) return;
    setter(path);
  }

  /**
   * SSH keys are extensionless (`id_ed25519`, `id_rsa`) and live in a hidden
   * folder, so this picker applies no filter and opens in ~/.ssh — with an
   * extension filter they'd be unselectable, and the folder unreachable
   * without knowing the Cmd+Shift+. shortcut.
   */
  async function pickPrivateKey() {
    let defaultPath: string | undefined;
    try {
      defaultPath = await join(await homeDir(), ".ssh");
    } catch {
      // Falls back to the system default location.
    }
    const path = await openFileDialog({ multiple: false, directory: false, defaultPath });
    if (!path || Array.isArray(path)) return;
    setSshPrivateKeyPath(path);
  }

  async function handleConnect() {
    if (!dialect) return;
    setConnecting(true);
    setError(null);

    const isSqlite = dialect === "Sqlite";
    const request = {
      dialect,
      name: name || (isSqlite ? (filePath.split("/").pop() ?? "New connection") : `${username}@${host}`),
      color,
      host: isSqlite ? null : host,
      port: isSqlite ? null : Number(port) || null,
      username: isSqlite ? null : username,
      password: isSqlite ? null : password,
      database: isSqlite ? null : database || null,
      sslMode: isSqlite ? null : sslMode,
      sslKeyPath: isSqlite ? null : sslKeyPath || null,
      sslCertPath: isSqlite ? null : sslCertPath || null,
      sslCaPath: isSqlite ? null : sslCaPath || null,
      filePath: isSqlite ? filePath : null,
      sshEnabled: !isSqlite && sshEnabled,
      sshHost: !isSqlite && sshEnabled ? sshHost : null,
      sshPort: !isSqlite && sshEnabled ? Number(sshPort) || 22 : null,
      sshUsername: !isSqlite && sshEnabled ? sshUsername : null,
      sshPassword: !isSqlite && sshEnabled && !sshUseKey ? sshPassword : null,
      sshUseKey: !isSqlite && sshEnabled && sshUseKey,
      sshPrivateKeyPath: !isSqlite && sshEnabled && sshUseKey ? sshPrivateKeyPath || null : null,
      sshPrivateKeyPassphrase:
        !isSqlite && sshEnabled && sshUseKey ? sshPrivateKeyPassphrase || null : null,
    };

    const result = editing
      ? await commands.updateConnection(editing.id, request)
      : await commands.openConnection(request);

    setConnecting(false);
    if (result.status === "error") {
      setError(friendlyError(result.error.message));
      return;
    }

    // Only a new connection is necessarily live; refetching the saved list
    // picks up an edit's new name/colour while preserving connected state.
    if (!editing) {
      addConnection({
        id: result.data.connectionId,
        name: result.data.displayName,
        dialect: result.data.dialect,
        color: result.data.color,
      });
    }
    queryClient.invalidateQueries({ queryKey: ["saved-connections"] });
    handleOpenChange(false);
  }

  const canConnect =
    dialect === "Sqlite"
      ? !!filePath
      : !!host && !!username && (!sshEnabled || (!!sshHost && !!sshUsername));
  const activeDialect = DIALECTS.find((d) => d.key === dialect);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 max-h-[85vh] w-[440px] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl shadow-black/40 focus:outline-none">
          {step === "pick" && (
            <>
              <Dialog.Title className="text-base font-semibold text-neutral-100">New Connection</Dialog.Title>
              <Dialog.Description className="mt-1 text-sm text-neutral-500">
                Choose a database to connect to.
              </Dialog.Description>
              <div className="mt-4 grid grid-cols-3 gap-2">
                {DIALECTS.map((meta) => (
                  <button
                    key={meta.key}
                    onClick={() => selectDialect(meta)}
                    className="flex flex-col items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 p-4 transition-colors hover:border-neutral-700 hover:bg-neutral-800"
                  >
                    <DialectBadge dialect={meta.key} size="lg" />
                    <span className="text-xs font-medium text-neutral-300">{meta.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {step === "configure" && dialect && (
            <>
              <div className="flex items-center gap-2">
                <DialectBadge dialect={dialect} />
                <Dialog.Title className="text-base font-semibold text-neutral-100">
                  {isEditing ? `Edit ${name || activeDialect?.label}` : activeDialect?.label}
                </Dialog.Title>
              </div>

              <div className="mt-4 space-y-3">
                <Field label="Name">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="My connection"
                    className={inputClass}
                  />
                </Field>

                <Field label="Colour">
                  <div className="flex items-center gap-1.5">
                    {CONNECTION_COLORS.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        onClick={() => setColor(c.value)}
                        title={c.label}
                        className={`h-6 w-6 rounded-full transition-transform ${
                          color === c.value ? "scale-110 ring-2 ring-white/70" : "hover:scale-105"
                        }`}
                        style={{ backgroundColor: c.value }}
                      />
                    ))}
                  </div>
                  {color === "#ef4444" && (
                    <p className="mt-1.5 text-[11px] text-red-400">
                      Marked as production — the header turns red so destructive edits are obvious.
                    </p>
                  )}
                </Field>

                {dialect === "Sqlite" ? (
                  <Field label="Database file">
                    <div className="flex gap-2">
                      <input
                        value={filePath}
                        readOnly
                        placeholder="No file selected"
                        className={`${inputClass} flex-1 text-neutral-400`}
                      />
                      <button
                        onClick={pickFile}
                        className="shrink-0 rounded-lg border border-neutral-700 px-3 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
                      >
                        Choose…
                      </button>
                    </div>
                  </Field>
                ) : (
                  <>
                    <div className="flex gap-2">
                      <Field label="Host" className="flex-[2]">
                        <input value={host} onChange={(e) => setHost(e.target.value)} className={inputClass} />
                      </Field>
                      <Field label="Port" className="flex-1">
                        <input value={port} onChange={(e) => setPort(e.target.value)} className={inputClass} />
                      </Field>
                    </div>
                    <div className="flex gap-2">
                      <Field label="User" className="flex-1">
                        <input
                          value={username}
                          onChange={(e) => setUsername(e.target.value)}
                          className={inputClass}
                        />
                      </Field>
                      <Field label="Password" className="flex-1">
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder={isEditing ? "Unchanged" : undefined}
                          className={`${inputClass} placeholder:italic placeholder:text-neutral-600`}
                        />
                      </Field>
                    </div>
                    <Field label="Database (optional)">
                      <input
                        value={database}
                        onChange={(e) => setDatabase(e.target.value)}
                        className={inputClass}
                      />
                    </Field>
                    <Field label="SSL mode">
                      <Select value={sslMode} onChange={setSslMode} options={SSL_MODES} />
                    </Field>
                    <Field label="SSL keys">
                      <div className="grid grid-cols-3 gap-2">
                        <CertButton label="Key…" set={sslKeyPath} onPick={() => pickCertFile(setSslKeyPath)} />
                        <CertButton label="Cert…" set={sslCertPath} onPick={() => pickCertFile(setSslCertPath)} />
                        <CertButton label="CA Cert…" set={sslCaPath} onPick={() => pickCertFile(setSslCaPath)} />
                      </div>
                    </Field>

                    <div className="border-t border-neutral-800 pt-3">
                      {/* A <label> wrapping a <button> forwards the click to it,
                          firing the handler twice; the row is a plain div. */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-neutral-300">Over SSH</span>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={sshEnabled}
                          onClick={() => setSshEnabled((v) => !v)}
                          className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${
                            sshEnabled ? "bg-indigo-600" : "bg-neutral-700"
                          }`}
                        >
                          {/* left-0.5 anchors the knob: without an explicit left it
                              resolves against its static position, which a button
                              centres, pushing it off the track when switched on. */}
                          <span
                            className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                              sshEnabled ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>

                      {sshEnabled && (
                        <div className="mt-3 space-y-3">
                          <div className="flex gap-2">
                            <Field label="Server" className="flex-[2]">
                              <input
                                value={sshHost}
                                onChange={(e) => setSshHost(e.target.value)}
                                className={inputClass}
                              />
                            </Field>
                            <Field label="Port" className="flex-1">
                              <input
                                value={sshPort}
                                onChange={(e) => setSshPort(e.target.value)}
                                className={inputClass}
                              />
                            </Field>
                          </div>
                          <div className="flex gap-2">
                            <Field label="User" className="flex-1">
                              <input
                                value={sshUsername}
                                onChange={(e) => setSshUsername(e.target.value)}
                                className={inputClass}
                              />
                            </Field>
                            {!sshUseKey && (
                              <Field label="Password" className="flex-1">
                                <input
                                  type="password"
                                  value={sshPassword}
                                  onChange={(e) => setSshPassword(e.target.value)}
                                  className={inputClass}
                                />
                              </Field>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-600">Stored in Keychain.</p>

                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={sshUseKey}
                              onChange={(e) => setSshUseKey(e.target.checked)}
                              className="accent-indigo-500"
                            />
                            <span className="text-xs text-neutral-400">Use SSH key</span>
                          </label>

                          {sshUseKey && (
                            <>
                              <Field label="Private key">
                                <div className="flex gap-2">
                                  <input
                                    value={sshPrivateKeyPath}
                                    readOnly
                                    placeholder="~/.ssh/id_ed25519"
                                    className={`${inputClass} flex-1 text-neutral-400`}
                                  />
                                  <button
                                    type="button"
                                    onClick={pickPrivateKey}
                                    className="shrink-0 rounded-lg border border-neutral-700 px-3 text-sm font-medium text-neutral-200 transition-colors hover:bg-neutral-800"
                                  >
                                    Choose…
                                  </button>
                                </div>
                              </Field>
                              <Field label="Passphrase (optional)">
                                <input
                                  type="password"
                                  value={sshPrivateKeyPassphrase}
                                  onChange={(e) => setSshPrivateKeyPassphrase(e.target.value)}
                                  className={inputClass}
                                />
                              </Field>
                              <p className="text-[11px] text-neutral-600">
                                Leave the private key empty to use one of ~/.ssh/id_ed25519, id_ecdsa or id_rsa.
                              </p>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {error && (
                <div className="mt-3 rounded-lg border border-red-900/50 bg-red-950/50 px-3 py-2 text-xs text-red-300">
                  {error}
                </div>
              )}

              <div className="mt-5 flex items-center justify-between">
                <button
                  onClick={() => (isEditing ? handleOpenChange(false) : setStep("pick"))}
                  className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-200"
                >
                  {isEditing ? "Cancel" : "Back"}
                </button>
                <button
                  onClick={handleConnect}
                  disabled={!canConnect || connecting}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {connecting
                    ? isEditing
                      ? "Saving…"
                      : "Connecting…"
                    : isEditing
                      ? "Save"
                      : "Connect"}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
