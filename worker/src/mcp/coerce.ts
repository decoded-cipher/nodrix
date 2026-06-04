// Some MCP transports (the claude.ai OAuth connector) JSON-stringify z.any()
// object/array args, so `graph`/`layout`/`config` can arrive as strings and the
// services silently reject them. Re-parse strings, but only when they yield an
// object/array — so a scalar value (e.g. a set_variable string) is never mangled.

export function parseStructured(v: unknown): unknown {
  if (typeof v !== 'string') return v;
  try {
    const parsed: unknown = JSON.parse(v);
    return parsed !== null && typeof parsed === 'object' ? parsed : v;
  } catch {
    return v;
  }
}

export function parseStructuredArray(v: unknown): unknown[] | undefined {
  const a = parseStructured(v);
  return Array.isArray(a) ? a.map(parseStructured) : undefined;
}
