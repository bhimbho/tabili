/**
 * Driver errors are written for operators, not users — "error returned from
 * database: 23505" tells you nothing. This maps the common ones onto plain
 * language while keeping the original available for the console.
 */
interface Rule {
  match: RegExp;
  message: (m: RegExpMatchArray) => string;
}

/**
 * Recovers the offending column from a constraint name.
 *
 * Postgres reports the constraint, not the column, and the DETAIL line that
 * names the value never reaches us. But the convention every migration tool
 * follows — Prisma, Rails, Django, Postgres itself — is `<table>_<column>_key`,
 * so the column is usually sitting right there in the name. Returns null when
 * the name doesn't follow it, rather than guessing.
 */
function columnFromConstraint(constraint: string): string | null {
  const match = constraint.match(/^.+?_(.+)_(?:key|unique|uniq|idx)$/i);
  return match ? match[1] : null;
}

const uniqueViolation = (column: string | null, constraint?: string) =>
  column
    ? `"${column}" already has that value — it must be unique.`
    : `That value already exists — it must be unique${constraint ? ` (${constraint})` : ""}.`;

const MAPPINGS: Rule[] = [
  {
    match: /duplicate key value violates unique constraint "?([^"\s]+)"?/i,
    message: (m) =>
      /_pkey$/i.test(m[1])
        ? "That primary key already exists — it must be unique."
        : uniqueViolation(columnFromConstraint(m[1]), m[1]),
  },
  {
    // MySQL: Duplicate entry 'x' for key 'organisations.slug' (or 'PRIMARY').
    match: /duplicate entry '(?:[^']*)' for key '([^']+)'/i,
    message: (m) => {
      const key = m[1].split(".").pop() ?? m[1];
      return key.toUpperCase() === "PRIMARY"
        ? "That primary key already exists — it must be unique."
        : uniqueViolation(columnFromConstraint(key) ?? key);
    },
  },
  {
    // SQLite: UNIQUE constraint failed: organisations.slug, organisations.name
    match: /unique constraint failed: ([^\n]+)/i,
    message: (m) => {
      const columns = m[1]
        .split(",")
        .map((part) => part.trim().split(".").pop() ?? "")
        .filter(Boolean);
      return columns.length > 0
        ? `${columns.map((c) => `"${c}"`).join(" and ")} already ${
            columns.length > 1 ? "have" : "has"
          } that value — ${columns.length > 1 ? "they" : "it"} must be unique.`
        : uniqueViolation(null);
    },
  },
  {
    match: /violates foreign key constraint/i,
    message: () =>
      "This row references another row that doesn't exist, or is still referenced elsewhere.",
  },
  {
    match: /violates not-null constraint.*column "([^"]+)"/is,
    message: (m) => `"${m[1]}" can't be empty.`,
  },
  {
    match: /null value in column "([^"]+)"/i,
    message: (m) => `"${m[1]}" can't be empty.`,
  },
  {
    match: /invalid input syntax for type (\w+)/i,
    message: (m) => `That value isn't a valid ${m[1]}.`,
  },
  {
    match: /value too long for type character varying\((\d+)\)/i,
    message: (m) => `That value is too long — the limit is ${m[1]} characters.`,
  },
  { match: /permission denied/i, message: () => "You don't have permission to do that." },
  {
    match: /password authentication failed|authentication failed/i,
    message: () => "Wrong username or password.",
  },
  {
    match: /database "([^"]+)" does not exist/i,
    message: (m) => `The database "${m[1]}" doesn't exist on this server.`,
  },
  {
    match: /relation "([^"]+)" does not exist/i,
    message: (m) => `The table "${m[1]}" doesn't exist. It may have been renamed or dropped.`,
  },
  {
    match: /column "([^"]+)" does not exist/i,
    message: (m) => `There's no column called "${m[1]}".`,
  },
  {
    match: /connection refused|could not connect|failed to lookup address|no route to host/i,
    message: () => "Couldn't reach the server. Check the host, port, and that it's running.",
  },
  { match: /timed out|timeout/i, message: () => "The server took too long to respond." },
  {
    match: /ssl|tls/i,
    message: () => "The secure connection failed. Try a different SSL mode.",
  },
  {
    match: /table has no primary key/i,
    message: () =>
      "This table has no primary key, so rows can't be edited safely. Add one to enable editing.",
  },
  { match: /unknown connection/i, message: () => "That connection isn't open any more. Reconnect and try again." },
  {
    match: /no such table: ([^\s]+)/i,
    message: (m) => `The table "${m[1]}" doesn't exist.`,
  },
  { match: /unable to open database file/i, message: () => "Couldn't open that database file." },
  { match: /database is locked/i, message: () => "The database is busy. Try again in a moment." },
];

export function friendlyError(raw: unknown): string {
  const text = raw instanceof Error ? raw.message : String(raw ?? "");
  if (!text) return "Something went wrong.";
  for (const rule of MAPPINGS) {
    const m = text.match(rule.match);
    if (m) return rule.message(m);
  }
  // Strip the driver's boilerplate prefixes so at worst the user sees the
  // server's own sentence rather than a wrapped stack of them.
  const cleaned = text
    .replace(/^(query failed|connection failed|error returned from database):\s*/i, "")
    .trim();
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/** Keeps the raw text around so the console can still show exactly what failed. */
export function errorDetail(raw: unknown): string {
  return raw instanceof Error ? raw.message : String(raw ?? "");
}
