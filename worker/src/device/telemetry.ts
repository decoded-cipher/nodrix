import { Hono } from 'hono';
import type { Env } from '../env';
import { requireDevice, type DeviceContextVars } from '../middleware/require-device';
import type { DeviceDO, IngestPoint } from '../do/device-do';

const telemetry = new Hono<{ Bindings: Env; Variables: DeviceContextVars }>();

telemetry.use('*', requireDevice);

// POST /v1/telemetry
// Body: { ts?: number, metrics: { [metric]: number|string|boolean } }
// or:   { ts?: number, metric: string, value: ... }
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
    for (const [metric, value] of Object.entries(body.metrics)) {
      points.push({ metric, value });
    }
  } else if (typeof body.metric === 'string') {
    points.push({ metric: body.metric, value: body.value ?? null });
  }
  if (points.length === 0) {
    return c.json({ error: 'no_metrics' }, 400);
  }

  const device = c.get('device');
  const stub = c.env.DEVICE_DO.get(c.env.DEVICE_DO.idFromName(device.id)) as unknown as DeviceDO;
  await stub.ingest(device.id, points, body.ts);

  // Best-effort: update D1 last_seen. Don't block the device response on it.
  c.executionCtx.waitUntil(
    c.env.DB.prepare('UPDATE devices SET last_seen = ? WHERE id = ?')
      .bind(Math.floor(Date.now() / 1000), device.id)
      .run()
      .then(() => undefined)
      .catch(() => undefined)
  );

  return c.body(null, 204);
});

export default telemetry;
