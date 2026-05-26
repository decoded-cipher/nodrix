// Small helpers for working with D1 rows.

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
