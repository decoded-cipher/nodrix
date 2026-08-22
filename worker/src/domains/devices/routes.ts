import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession } from '../../platform/middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../../platform/middleware/resolve-project';
import { recordAudit } from '../../platform/lib/audit';
import { listDevices, renameDevice, forgetDevice } from './service';
import { actorFromSession, serviceErrorResponse } from '../../platform/lib/service';

const devices = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

devices.use('*', requireSession);
devices.use('*', resolveProject);

devices.get('/', async (c) => {
  const project = c.get('project');
  return c.json({ devices: await listDevices(c.env, project.id) });
});

devices.patch('/:id', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string }>();
  try {
    const device = await renameDevice(c.env, project.id, id, body.name ?? '');
    await recordAudit(c.env, {
      projectId: project.id,
      userId: c.get('user').id,
      action: 'device.rename',
      targetType: 'device',
      targetId: id,
      metadata: { name: device.name },
    });
    return c.json({ device });
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

devices.delete('/:id', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  try {
    await forgetDevice(c.env, project.id, id);
    await recordAudit(c.env, {
      projectId: project.id,
      userId: c.get('user').id,
      action: 'device.forget',
      targetType: 'device',
      targetId: id,
      metadata: { source: actorFromSession(c.get('user')).source },
    });
    return c.body(null, 204);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

export default devices;
