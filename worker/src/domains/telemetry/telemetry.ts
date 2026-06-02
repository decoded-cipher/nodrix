import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../../platform/middleware/require-project-token';
import { newId } from '../../platform/lib/ids';
import { chunk, MAX_BOUND_PARAMS } from '../../platform/lib/sql';
import { projectStub } from '../../platform/durable-objects/stubs';
import { parseTelemetryBody, MAX_POINTS, MAX_KEY_LEN, MAX_STRING_VALUE } from './validate';

const telemetry = new Hono<{ Bindings: Env; Variables: ProjectTokenContextVars }>();

telemetry.use('*', requireProjectToken);

const MAX_BODY_BYTES = 256 * 1024;

// Per-request caps only bound a single POST; a device sending fresh keys across
// many requests could still grow project_variables without bound. Cap the total
// distinct auto-created variables per project (enforced in upsertVariables).
const MAX_VARIABLES_PER_PROJECT = 250;

// Body: { metrics: { [key]: number|string|boolean } } or { metric, value }.
// Readings are stamped server-side at receive time, so clockless devices
// (ESP/Arduino) don't send a timestamp. Response: 204 No Content.
telemetry.post('/', async (c) => {
  const len = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(len) && len > MAX_BODY_BYTES) {
    return c.json({ error: 'payload_too_large', max_bytes: MAX_BODY_BYTES }, 413);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_json' }, 400);
  }

  const parsed = parseTelemetryBody(body);
  if (!parsed.ok) {
    switch (parsed.error.code) {
      case 'too_many_metrics': return c.json({ error: 'too_many_metrics', max: MAX_POINTS }, 413);
      case 'invalid_key':
        return c.json({ error: 'invalid_key', reason: `keys must be 1-${MAX_KEY_LEN} chars with no control characters` }, 400);
      case 'invalid_value':
        return c.json({ error: 'invalid_value', key: parsed.error.key, reason: `values must be number | string(<=${MAX_STRING_VALUE}) | boolean | null` }, 400);
      default: return c.json({ error: parsed.error.code }, 400); // invalid_body | no_metrics
    }
  }
  const points = parsed.points;

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
// INSERT idempotent; the UPDATE keeps last_seen current for existing rows. New
// keys are created only under MAX_VARIABLES_PER_PROJECT; existing keys always refresh.
async function upsertVariables(
  env: Env,
  projectId: string,
  keys: string[],
  now: number
): Promise<void> {
  const nowMs = Date.now();
  // Only touch keys whose last_seen is actually due (throttled per isolate).
  const due = [...new Set(keys)].filter((key) => dueForLastSeen(projectId, key, nowMs));
  if (due.length === 0) return;
  try {
    // Existing rows only need last_seen refreshed; new keys count against the cap.
    // Chunk the IN(...) lookup under the 100 bound-param limit (project_id takes one).
    const existing = new Set<string>();
    for (const part of chunk(due, MAX_BOUND_PARAMS - 1)) {
      const placeholders = part.map(() => '?').join(',');
      const rows = await env.DB
        .prepare(`SELECT key FROM project_variables WHERE project_id = ? AND key IN (${placeholders})`)
        .bind(projectId, ...part)
        .all<{ key: string }>();
      for (const r of rows.results) existing.add(r.key);
    }

    let toCreate = due.filter((key) => !existing.has(key));
    if (toCreate.length > 0) {
      const countRow = await env.DB
        .prepare(`SELECT COUNT(*) AS n FROM project_variables WHERE project_id = ?`)
        .bind(projectId)
        .first<{ n: number }>();
      const remaining = Math.max(0, MAX_VARIABLES_PER_PROJECT - (countRow?.n ?? 0));
      // Best-effort guardrail: a small overshoot under concurrency is acceptable
      // since the cap bounds growth rather than enforcing an exact invariant.
      toCreate = toCreate.slice(0, remaining);
    }

    const keysToWrite = [...existing, ...toCreate];
    if (keysToWrite.length === 0) return;
    await env.DB.batch(
      keysToWrite.map((key) =>
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
    // last_seen + auto-create are best-effort; never fail telemetry on them.
    // Clear the throttle stamps so a failed write retries on the next POST
    // instead of waiting out the window.
    for (const key of due) lastSeenWrites.delete(`${projectId}:${key}`);
  }
}

export default telemetry;
