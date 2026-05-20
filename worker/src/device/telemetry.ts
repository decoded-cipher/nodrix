import { Hono } from 'hono';
import type { Env } from '../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../middleware/require-project-token';
import { newId } from '../lib/ids';
import type { ProjectDO, IngestPoint } from '../do/project-do';

const telemetry = new Hono<{ Bindings: Env; Variables: ProjectTokenContextVars }>();

telemetry.use('*', requireProjectToken);

// POST /v1/telemetry
// Body: { ts?: number, metrics: { [key]: number|string|boolean } }
// or:   { ts?: number, metric: string, value: ... }
// (`metrics`/`metric` are accepted as the variable keys.)
// Response: 204 No Content.
telemetry.post('/', async (c) => {
  const body = await c.req.json<{
    ts?: number;
    metrics?: Record<string, number | string | boolean | null>;
    metric?: string;
    value?: number | string | boolean | null;
  }>();

  const points: IngestPoint[] = [];
  if (body.metrics && typeof body.metrics === 'object') {
    for (const [variable, value] of Object.entries(body.metrics)) {
      points.push({ variable, value });
    }
  } else if (typeof body.metric === 'string') {
    points.push({ variable: body.metric, value: body.value ?? null });
  }
  if (points.length === 0) {
    return c.json({ error: 'no_metrics' }, 400);
  }

  const { project_id } = c.get('projectToken');
  const stub = c.env.PROJECT_DO.get(c.env.PROJECT_DO.idFromName(project_id)) as unknown as ProjectDO;
  await stub.ingest(project_id, points, body.ts);

  // Best-effort: permissively auto-create variable rows for any new keys and
  // bump last_seen. Don't block the device response on it.
  const now = Math.floor(Date.now() / 1000);
  c.executionCtx.waitUntil(
    upsertVariables(c.env, project_id, points.map((p) => p.variable), now)
  );

  return c.body(null, 204);
});

// Permissive ingest: ensure a project_variables row exists for each key (created
// on first sight) and refresh last_seen. UNIQUE(project_id, key) makes the
// INSERT idempotent; the UPDATE keeps last_seen current for existing rows.
async function upsertVariables(
  env: Env,
  projectId: string,
  keys: string[],
  now: number
): Promise<void> {
  const unique = [...new Set(keys)];
  try {
    await env.DB.batch(
      unique.flatMap((key) => [
        env.DB
          .prepare(
            `INSERT INTO project_variables (id, project_id, key, created_at, updated_at, last_seen)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(project_id, key) DO UPDATE SET last_seen = excluded.last_seen`
          )
          .bind(newId('variable'), projectId, key, now, now, now),
      ])
    );
  } catch {
    // last_seen is best-effort; never fail telemetry on it.
  }
}

export default telemetry;
