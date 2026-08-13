import { useState, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { commands } from "../../bindings";
import { useConnectionsStore, type Dialect } from "../../stores/connectionsStore";
import { DialectBadge } from "./DialectBadge";
import { Select } from "../ui/Select";

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

export function NewConnectionDialog({ open, onOpenChange }: NewConnectionDialogProps) {
  const addConnection = useConnectionsStore((s) => s.addConnection);
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>("pick");
  const [dialect, setDialect] = useState<Dialect | null>(null);
  const [name, setName] = useState("");
  const [host, setHost] = useState("127.0.0.1");
  const [port, setPort] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [database, setDatabase] = useState("");
  const [sslMode, setSslMode] = useState("prefer");
  const [sslKeyPath, setSslKeyPath] = useState("");
  const [sslCertPath, setSslCertPath] = useState("");
  const [sslCaPath, setSslCaPath] = useState("");
  const [filePath, setFilePath] = useState("");
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
    setSslMode("prefer");
    setSslKeyPath("");
    setSslCertPath("");
    setSslCaPath("");
    setFilePath("");
    setConnecting(false);
    setError(null);
  }

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
      filters: [{ name: "SQLite database", extensions: ["sqlite", "sqlite3", "db"] }],
    });
    if (!path || Array.isArray(path)) return;
    setFilePath(path);
    if (!name) setName(path.split("/").pop() ?? path);
  }

  async function pickCertFile(setter: (path: string) => void) {
    const path = await openFileDialog({
      multiple: false,
      directory: false,
      filters: [{ name: "Certificate / Key", extensions: ["pem", "crt", "cer", "key", "p12", "pfx"] }],
    });
    if (!path || Array.isArray(path)) return;
    setter(path);
  }

  async function handleConnect() {
    if (!dialect) return;
    setConnecting(true);
    setError(null);

    const isSqlite = dialect === "Sqlite";
    const result = await commands.openConnection({
      dialect,
      name: name || (isSqlite ? (filePath.split("/").pop() ?? "New connection") : `${username}@${host}`),
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
    });

    setConnecting(false);
    if (result.status === "error") {
      setError(result.error.message);
      return;
    }
    addConnection({
      id: result.data.connectionId,
      name: result.data.displayName,
      dialect: result.data.dialect,
    });
    queryClient.invalidateQueries({ queryKey: ["saved-connections"] });
    handleOpenChange(false);
  }

  const canConnect = dialect === "Sqlite" ? !!filePath : !!host && !!username;
  const activeDialect = DIALECTS.find((d) => d.key === dialect);

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay fixed inset-0 bg-black/50 backdrop-blur-[2px]" />
        <Dialog.Content className="dialog-content fixed left-1/2 top-1/2 w-[440px] -translate-x-1/2 -translate-y-1/2 rounded-xl border border-neutral-800 bg-neutral-900 p-5 shadow-xl shadow-black/40 focus:outline-none">
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
                  {activeDialect?.label}
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
                          className={inputClass}
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
                  onClick={() => setStep("pick")}
                  className="rounded-lg px-3 py-1.5 text-sm text-neutral-400 transition-colors hover:text-neutral-200"
                >
                  Back
                </button>
                <button
                  onClick={handleConnect}
                  disabled={!canConnect || connecting}
                  className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {connecting ? "Connecting…" : "Connect"}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
