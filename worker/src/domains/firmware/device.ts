import { Hono, type Context } from 'hono';
import type { Env } from '../../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../../platform/middleware/require-project-token';
import { normaliseDeviceKey, recordDeviceSeen, resolveDevice, touchDevice } from '../devices/service';
import { offerFor, openImage, reconcile, recordOtaAttempt, recordOtaReport } from './ota';
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

  const image = await openImage(c.env, project_id, deviceId);
  if (!image) return c.json({ error: 'not_found' }, 404);
  c.executionCtx.waitUntil(recordOtaAttempt(c.env, deviceId));
  const headers: Record<string, string> = {
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(image.object.size),
    'x-SHA256': image.sha256,
  };
  if (image.md5) headers['x-MD5'] = image.md5;
  return new Response(image.object.body, { headers });
});

// POST /v1/ota/status  body: { state: 'failed' | 'rolled_back', version?, code? }
ota.post('/status', async (c) => {
  const { project_id } = c.get('projectToken');
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}) as Record<string, unknown>);
  const state = body.state;
  if (state !== 'failed' && state !== 'rolled_back') return c.json({ error: 'bad_state' }, 400);
  const deviceId = await deviceIdFor(c, project_id);
  if (!deviceId) return c.json({ error: 'not_found' }, 404);
  await recordOtaReport(c.env, deviceId, {
    state,
    version: typeof body.version === 'string' ? body.version : undefined,
    code: typeof body.code === 'number' ? body.code : undefined,
  });
  return c.body(null, 204);
});

export default ota;
