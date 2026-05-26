import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../../platform/middleware/require-project-token';
import { newId } from '../../platform/lib/ids';
import { projectStub } from '../../platform/durable-objects/stubs';
import type { IngestPoint } from '../../platform/durable-objects/project-do';

const telemetry = new Hono<{ Bindings: Env; Variables: ProjectTokenContextVars }>();

telemetry.use('*', requireProjectToken);

// A valid project token authorizes a device, but the payload is still untrusted:
// these caps stop a buggy/compromised device exploding variable cardinality,
// storing oversized values, or polluting the time series.
const MAX_BODY_BYTES = 256 * 1024;
const MAX_POINTS = 200;
const MAX_KEY_LEN = 64;
const MAX_STRING_VALUE = 512;

const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function validKey(k: string): boolean {
  return k.length >= 1 && k.length <= MAX_KEY_LEN && !CONTROL_CHARS.test(k);
}

function validValue(v: unknown): v is number | string | boolean | null {
  if (v === null) return true;
  switch (typeof v) {
    case 'number': return Number.isFinite(v);
    case 'boolean': return true;
    case 'string': return v.length <= MAX_STRING_VALUE;
    default: return false;
  }
}

// Body: { metrics: { [key]: number|string|boolean } } or { metric, value }.
// Readings are stamped server-side at receive time, so clockless devices
// (ESP/Arduino) don't send a timestamp.
// Response: 204 No Content.
telemetry.post('/', async (c) => {
  const len = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return c.json({ error: 'payload_too_large', max_bytes: MAX_BODY_BYTES }, 413);
  }

  let body: {
    metrics?: Record<string, unknown>;
    metric?: unknown;
    value?: unknown;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return c.json({ error: 'invalid_body' }, 400);
  }

  // Collect raw (key, value) pairs from either accepted shape.
  const raw: Array<[string, unknown]> = [];
  if (body.metrics && typeof body.metrics === 'object' && !Array.isArray(body.metrics)) {
    for (const [k, v] of Object.entries(body.metrics)) raw.push([k, v]);
  } else if (typeof body.metric === 'string') {
    raw.push([body.metric, body.value ?? null]);
  }

  if (raw.length === 0) return c.json({ error: 'no_metrics' }, 400);
  if (raw.length > MAX_POINTS) {
    return c.json({ error: 'too_many_metrics', max: MAX_POINTS }, 413);
  }

  // Reject the whole batch on any bad key/value rather than silently dropping.
  const points: IngestPoint[] = [];
  for (const [variable, value] of raw) {
    if (!validKey(variable)) {
      return c.json({ error: 'invalid_key', reason: `keys must be 1-${MAX_KEY_LEN} chars with no control characters` }, 400);
    }
    if (!validValue(value)) {
      return c.json({ error: 'invalid_value', key: variable, reason: `values must be number | string(<=${MAX_STRING_VALUE}) | boolean | null` }, 400);
    }
    points.push({ variable, value });
  }

  const { project_id } = c.get('projectToken');
  const stub = projectStub(c.env, project_id);
  await stub.ingest(project_id, points);

  // Best-effort: permissively auto-create variable rows for any new keys and
  // bump last_seen. Don't block the device response on it.
  const now = Math.floor(Date.now() / 1000);
  c.executionCtx.waitUntil(
    upsertVariables(c.env, project_id, points.map((p) => p.variable), now)
  );

  return c.body(null, 204);
});

// Best-effort in-isolate throttle so a chatty device doesn't rewrite
// project_variables.last_seen on every POST. Isolates are short-lived, so the
// worst case is one write per key per window per isolate — far fewer than
// per-request. A key never seen in this isolate always writes, so first-sight
// auto-creation stays immediate.
const LAST_SEEN_THROTTLE_MS = 60_000;
const lastSeenWrites = new Map<string, number>();

function dueForLastSeen(projectId: string, key: string, nowMs: number): boolean {
  const k = `${projectId}:${key}`;
  const prev = lastSeenWrites.get(k);
  if (prev !== undefined && nowMs - prev < LAST_SEEN_THROTTLE_MS) return false;
  lastSeenWrites.set(k, nowMs);
  // Soft cap: drop stale entries if the map grows large (high key cardinality).
  if (lastSeenWrites.size > 10_000) {
    const cutoff = nowMs - LAST_SEEN_THROTTLE_MS;
    for (const [mk, t] of lastSeenWrites) if (t < cutoff) lastSeenWrites.delete(mk);
  }
  return true;
}

// Permissive ingest: ensure a project_variables row exists for each key (created
// on first sight) and refresh last_seen. UNIQUE(project_id, key) makes the
// INSERT idempotent; the UPDATE keeps last_seen current for existing rows.
async function upsertVariables(
  env: Env,
  projectId: string,
  keys: string[],
  now: number
): Promise<void> {
  const nowMs = Date.now();
  // Only write keys whose last_seen is actually due — and only generate an id for
  // those (the ON CONFLICT path discards it, so it was wasted for existing rows).
  const due = [...new Set(keys)].filter((key) => dueForLastSeen(projectId, key, nowMs));
  if (due.length === 0) return;
  try {
    await env.DB.batch(
      due.map((key) =>
        env.DB
          .prepare(
            `INSERT INTO project_variables (id, project_id, key, created_at, updated_at, last_seen)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(project_id, key) DO UPDATE SET last_seen = excluded.last_seen`
          )
          .bind(newId('variable'), projectId, key, now, now, now)
      )
    );
  } catch {
    // last_seen is best-effort; never fail telemetry on it. Clear the throttle
    // stamps so a failed write retries on the next POST instead of waiting out
    // the window.
    for (const key of due) lastSeenWrites.delete(`${projectId}:${key}`);
  }
}

export default telemetry;
