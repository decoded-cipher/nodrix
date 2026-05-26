import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../../platform/middleware/require-project-token';
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

export default control;
