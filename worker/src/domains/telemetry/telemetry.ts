import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../../platform/middleware/require-project-token';
import { projectStub } from '../../platform/durable-objects/stubs';
import { parseTelemetryBody, MAX_POINTS, MAX_KEY_LEN, MAX_STRING_VALUE } from './validate';
import { upsertVariables } from './variables';

const telemetry = new Hono<{ Bindings: Env; Variables: ProjectTokenContextVars }>();

telemetry.use('*', requireProjectToken);

const MAX_BODY_BYTES = 256 * 1024;

// Body: { metrics: {…} } or { metric, value }. Stamped server-side (clockless devices send no
// timestamp); 204 on success. The same ingest also runs over the WS (project-do webSocketMessage).
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

  // Auto-create new variables + bump last_seen off the response path (best-effort).
  const now = Math.floor(Date.now() / 1000);
  c.executionCtx.waitUntil(
    upsertVariables(c.env, project_id, points.map((p) => p.variable), now)
  );

  return c.body(null, 204);
});

export default telemetry;
