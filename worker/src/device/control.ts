import { Hono } from 'hono';
import type { Env } from '../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../middleware/require-project-token';
import type { ProjectDO } from '../do/project-do';

const control = new Hono<{ Bindings: Env; Variables: ProjectTokenContextVars }>();

control.use('*', requireProjectToken);

// GET /v1/control  -> { control: [{ id, variable, value }, ...] }
// Pending cloud->hardware variable writes for the authenticated project.
control.get('/', async (c) => {
  const { project_id } = c.get('projectToken');
  const stub = c.env.PROJECT_DO.get(c.env.PROJECT_DO.idFromName(project_id)) as unknown as ProjectDO;
  const pending = await stub.listPendingControl();
  return c.json({ control: pending });
});

// POST /v1/control/ack  body: { ids: string[] }  -> { acked: number }
control.post('/ack', async (c) => {
  const body = await c.req.json<{ ids?: string[] }>();
  const ids = Array.isArray(body.ids) ? body.ids.filter((x) => typeof x === 'string') : [];
  if (ids.length === 0) return c.json({ acked: 0 });

  const { project_id } = c.get('projectToken');
  const stub = c.env.PROJECT_DO.get(c.env.PROJECT_DO.idFromName(project_id)) as unknown as ProjectDO;
  const result = await stub.ackControl(ids);
  return c.json(result);
});

export default control;
