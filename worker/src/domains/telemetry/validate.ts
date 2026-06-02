// Pure validation + parsing for the telemetry ingest body. Split out from the
// route so the untrusted-input rules are unit-testable without a Durable Object.
//
// A valid project token authorizes a device, but the payload is still untrusted:
// these caps stop a buggy/compromised device exploding the series, storing
// oversized values, or flooding keys in a single POST.

import type { IngestPoint } from '../../platform/durable-objects/project-do';

export const MAX_POINTS = 200;
export const MAX_KEY_LEN = 64;
export const MAX_STRING_VALUE = 512;

// eslint-disable-next-line no-control-regex -- intentionally rejects control chars
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

export function validKey(k: string): boolean {
  return k.length >= 1 && k.length <= MAX_KEY_LEN && !CONTROL_CHARS.test(k);
}

export function validValue(v: unknown): v is number | string | boolean | null {
  if (v === null) return true;
  switch (typeof v) {
    case 'number': return Number.isFinite(v);
    case 'boolean': return true;
    case 'string': return v.length <= MAX_STRING_VALUE;
    default: return false;
  }
}

export type TelemetryParseError =
  | { code: 'invalid_body' }
  | { code: 'no_metrics' }
  | { code: 'too_many_metrics' }
  | { code: 'invalid_key' }
  | { code: 'invalid_value'; key: string };

export type TelemetryParseResult =
  | { ok: true; points: IngestPoint[] }
  | { ok: false; error: TelemetryParseError };

// Accepts { metrics: { key: value } } or { metric, value }. Rejects the whole
// batch on any bad key/value rather than silently dropping points.
export function parseTelemetryBody(body: unknown): TelemetryParseResult {
  if (!body || typeof body !== 'object') return { ok: false, error: { code: 'invalid_body' } };
  const b = body as { metrics?: unknown; metric?: unknown; value?: unknown };

  const raw: Array<[string, unknown]> = [];
  if (b.metrics && typeof b.metrics === 'object' && !Array.isArray(b.metrics)) {
    for (const [k, v] of Object.entries(b.metrics as Record<string, unknown>)) raw.push([k, v]);
  } else if (typeof b.metric === 'string') {
    raw.push([b.metric, b.value ?? null]);
  }

  if (raw.length === 0) return { ok: false, error: { code: 'no_metrics' } };
  if (raw.length > MAX_POINTS) return { ok: false, error: { code: 'too_many_metrics' } };

  const points: IngestPoint[] = [];
  for (const [variable, value] of raw) {
    if (!validKey(variable)) return { ok: false, error: { code: 'invalid_key' } };
    if (!validValue(value)) return { ok: false, error: { code: 'invalid_value', key: variable } };
    points.push({ variable, value });
  }
  return { ok: true, points };
}
