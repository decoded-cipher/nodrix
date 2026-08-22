import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession } from '../../platform/middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../../platform/middleware/resolve-project';
import { recordAudit } from '../../platform/lib/audit';
import { serviceErrorResponse } from '../../platform/lib/service';
import { listFirmware, deleteFirmware, assignFirmware } from './ota';

const admin = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

admin.use('*', requireSession);
admin.use('*', resolveProject);

admin.get('/', async (c) => {
  const project = c.get('project');
  return c.json({ firmware: await listFirmware(c.env, project.id) });
});

admin.delete('/:id', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  try {
    await deleteFirmware(c.env, project.id, id);
    await recordAudit(c.env, {
      projectId: project.id,
      userId: c.get('user').id,
      action: 'firmware.delete',
      targetType: 'firmware',
      targetId: id,
    });
    return c.body(null, 204);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

admin.put('/assign/:deviceId', async (c) => {
  const project = c.get('project');
  const deviceId = c.req.param('deviceId');
  const body = await c.req.json<{ firmware_id?: string | null }>();
  try {
    await assignFirmware(c.env, project.id, deviceId, body.firmware_id ?? null);
    await recordAudit(c.env, {
      projectId: project.id,
      userId: c.get('user').id,
      action: 'firmware.assign',
      targetType: 'device',
      targetId: deviceId,
      metadata: { firmware_id: body.firmware_id ?? null },
    });
    return c.body(null, 204);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

export default admin;
