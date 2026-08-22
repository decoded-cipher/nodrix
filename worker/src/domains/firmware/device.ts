import { Hono, type Context } from 'hono';
import type { Env } from '../../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../../platform/middleware/require-project-token';
import { normaliseDeviceKey, recordDeviceSeen, resolveDevice, touchDevice } from '../devices/service';
import { offerFor, openImage, reconcile } from './ota';
import { projectStub } from '../../platform/durable-objects/stubs';
import { storageIdOf } from '../devices/service';

type OtaContext = Context<{ Bindings: Env; Variables: ProjectTokenContextVars }>;

const ota = new Hono<{ Bindings: Env; Variables: ProjectTokenContextVars }>();

ota.use('*', requireProjectToken);

async function deviceIdFor(c: OtaContext, projectId: string, seen = true) {
  const device = await resolveDevice(
    c.env,
    projectId,
    normaliseDeviceKey(c.req.header('x-nodrix-device')),
    Math.floor(Date.now() / 1000)
  );
  if (device && seen) c.executionCtx.waitUntil(touchDevice(c.env, device.id));
  return device?.id ?? null;
}

// null means the board is already where it should be.
ota.get('/', async (c) => {
  const { project_id } = c.get('projectToken');
  // An HTTP-mode board has no hello frame, so this is where it reports what it
  // runs — without it a finished update is offered again forever.
  const firmware = c.req.header('x-nodrix-firmware') ?? null;
  const deviceId = await deviceIdFor(c, project_id, !firmware);
  if (!deviceId) return c.json({ update: null });

  if (firmware) {
    c.executionCtx.waitUntil(
      recordDeviceSeen(c.env, deviceId, c.req.header('x-nodrix-chip'), firmware)
        .then(() => reconcile(c.env, deviceId, firmware))
    );
  }
  return c.json({ update: await offerFor(c.env, project_id, deviceId, firmware) });
});

ota.get('/image', async (c) => {
  const { project_id } = c.get('projectToken');
  const deviceId = await deviceIdFor(c, project_id);
  if (!deviceId) return c.json({ error: 'not_found' }, 404);
  const storageId = await storageIdOf(c.env, project_id, deviceId);
  if (!(await projectStub(c.env, project_id).consumeOtaQuota(storageId))) {
    return c.json({ error: 'too_many_requests' }, 429, { 'retry-after': '3600' });
  }

  const object = await openImage(c.env, project_id, deviceId);
  if (!object) return c.json({ error: 'not_found' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size),
    },
  });
});

export default ota;
