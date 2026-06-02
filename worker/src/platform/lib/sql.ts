// Small helpers for working with D1 rows.

// D1 and DO SQLite both cap a query at 100 bound parameters. Any statement that
// builds an IN (...) list or a multi-row VALUES from runtime input must chunk its
// inputs to stay under this, or large-but-valid batches fail at the SQLite layer.
export const MAX_BOUND_PARAMS = 100;

// Split `items` into consecutive chunks of at most `size`.
export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Placeholder list `(?, ?, …)` for an `IN` clause. Keep `count` within
// MAX_BOUND_PARAMS (chunk() the inputs if larger).
export function inClause(count: number): string {
  return `(${Array(count).fill('?').join(', ')})`;
}

// Parse JSON from a text column we wrote ourselves, tolerating corruption by
// returning null rather than throwing.
export function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Assemble the SET clause + bind values for a partial UPDATE. Only columns whose
// value is not `undefined` are included (so `null` clears a column, `undefined`
// leaves it untouched). Returns null when nothing was provided.
export function buildUpdate(
  fields: Record<string, unknown>
): { clause: string; values: unknown[] } | null {
  const cols = Object.keys(fields).filter((c) => fields[c] !== undefined);
  if (cols.length === 0) return null;
  return { clause: cols.map((c) => `${c} = ?`).join(', '), values: cols.map((c) => fields[c]) };
}
