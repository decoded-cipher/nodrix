import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../../platform/middleware/require-project-token';
import { normaliseDeviceKey, resolveDevice } from '../devices/service';
import { offerFor, openImage } from './ota';

const ota = new Hono<{ Bindings: Env; Variables: ProjectTokenContextVars }>();

ota.use('*', requireProjectToken);

async function deviceIdFor(c: { env: Env; req: { header: (n: string) => string | undefined } }, projectId: string) {
  const device = await resolveDevice(
    c.env,
    projectId,
    normaliseDeviceKey(c.req.header('x-nodrix-device')),
    Math.floor(Date.now() / 1000)
  );
  return device?.id ?? null;
}

// null means the board is already where it should be.
ota.get('/', async (c) => {
  const { project_id } = c.get('projectToken');
  const deviceId = await deviceIdFor(c, project_id);
  if (!deviceId) return c.json({ update: null });
  return c.json({ update: await offerFor(c.env, project_id, deviceId) });
});

ota.get('/image', async (c) => {
  const { project_id } = c.get('projectToken');
  const deviceId = await deviceIdFor(c, project_id);
  if (!deviceId) return c.json({ error: 'not_found' }, 404);
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
