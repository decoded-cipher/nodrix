import { Hono, type Context } from 'hono';
import type { Env } from '../../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../../platform/middleware/require-project-token';
import { lookupProjectToken, touchTokenLastUsed } from '../../platform/lib/tokens';
import { projectStub } from '../../platform/durable-objects/stubs';

const control = new Hono<{ Bindings: Env; Variables: ProjectTokenContextVars }>();

control.use('*', requireProjectToken);

// GET /v1/control  -> { control: [{ id, variable, value }, ...] }
// Pending cloud->hardware variable writes for the authenticated project.
control.get('/', async (c) => {
  const { project_id } = c.get('projectToken');
  const stub = projectStub(c.env, project_id);
  const pending = await stub.listPendingControl();
  return c.json({ control: pending });
});

// POST /v1/control/ack  body: { ids: string[] }  -> { acked: number }
control.post('/ack', async (c) => {
  const body = await c.req.json<{ ids?: string[] }>();
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
  if (ids.length === 0) return c.json({ acked: 0 });

  const { project_id } = c.get('projectToken');
  const stub = projectStub(c.env, project_id);
  const result = await stub.ackControl(ids);
  return c.json(result);
});

// Control WebSocket upgrade (mounted at /v1/control/ws). Separate from the routes
// above because the token may arrive as ?token= (WS clients can't set headers on
// the upgrade), so it can't use the requireProjectToken middleware.
export async function controlWsHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim() || c.req.query('token');
  if (!token) return c.text('unauthorized', 401);
  if (c.req.header('upgrade') !== 'websocket') return c.text('expected websocket', 426);

  const row = await lookupProjectToken(c.env, token);
  if (!row) return c.text('unauthorized', 401);

  c.executionCtx.waitUntil(touchTokenLastUsed(c.env, 'project', row.id));
  // project_id rides the upgrade request so the DO stamps it without a separate
  // setProjectId RPC (matters even if the device never uses HTTP ingest).
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-nodrix-project-id', row.project_id);
  const fwd = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers,
    body: c.req.raw.body,
  });
  return projectStub(c.env, row.project_id).fetch(fwd);
}

export default control;
