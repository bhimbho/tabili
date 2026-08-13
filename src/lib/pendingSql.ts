import type { DbValue } from "../bindings";
import type { PendingDelete, PendingEdit, PendingInsert } from "../stores/changesStore";

export interface EditGroup {
  connectionId: string;
  table: string;
  schema: string | null;
  pkKey: string;
  pk: Record<string, DbValue>;
  changes: Record<string, DbValue>;
}

/** Collapses per-cell edits into one UPDATE per row. */
export function groupEdits(edits: PendingEdit[]): EditGroup[] {
  const groups = new Map<string, EditGroup>();
  for (const edit of edits) {
    const groupKey = `${edit.connectionId}:${edit.table}:${edit.pkKey}`;
    const existing = groups.get(groupKey);
    if (existing) {
      existing.changes[edit.column] = edit.newValue;
    } else {
      groups.set(groupKey, {
        connectionId: edit.connectionId,
        table: edit.table,
        schema: edit.schema,
        pkKey: edit.pkKey,
        pk: edit.pk,
        changes: { [edit.column]: edit.newValue },
      });
    }
  }
  return Array.from(groups.values());
}

function displayText(value: DbValue): string {
  switch (value.type) {
    case "Null":
      return "";
    case "Default":
      return "DEFAULT";
    case "Now":
      return "CURRENT_TIMESTAMP";
    case "Bool":
    case "Int":
    case "Float":
      return String(value.value);
    case "Decimal":
    case "Text":
    case "DateTime":
    case "Uuid":
      return value.value;
    default:
      return JSON.stringify(value);
  }
}

/** Display-only rendering for the review dialog; execution uses bound parameters. */
export function sqlLiteral(value: DbValue): string {
  switch (value.type) {
    case "Null":
      return "NULL";
    // Emitted as a bare keyword so the preview matches the statement that runs.
    case "Default":
      return "DEFAULT";
    case "Now":
      return "CURRENT_TIMESTAMP";
    case "Bool":
      return value.value ? "true" : "false";
    case "Int":
    case "Float":
      return String(value.value);
    case "Decimal":
      return value.value;
    default:
      return `'${displayText(value).replace(/'/g, "''")}'`;
  }
}

export function editSql(g: EditGroup): string {
  const set = Object.entries(g.changes).map(([c, v]) => `${c} = ${sqlLiteral(v)}`).join(", ");
  const where = Object.entries(g.pk).map(([c, v]) => `${c} = ${sqlLiteral(v)}`).join(" AND ");
  return `UPDATE ${g.table} SET ${set} WHERE ${where};`;
}

export function insertSql(i: PendingInsert): string {
  const cols = Object.keys(i.values);
  const vals = cols.map((c) => sqlLiteral(i.values[c]));
  return `INSERT INTO ${i.table} (${cols.join(", ")}) VALUES (${vals.join(", ")});`;
}

export function deleteSql(d: PendingDelete): string {
  const where = Object.entries(d.pk).map(([c, v]) => `${c} = ${sqlLiteral(v)}`).join(" AND ");
  return `DELETE FROM ${d.table} WHERE ${where};`;
}
