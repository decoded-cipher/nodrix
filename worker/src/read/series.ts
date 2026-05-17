import { Hono } from 'hono';
import type { Env } from '../env';
import { requireUserToken, type UserTokenContextVars } from '../middleware/require-user-token';
import type { DeviceDO } from '../do/device-do';

const series = new Hono<{ Bindings: Env; Variables: UserTokenContextVars }>();

series.use('*', requireUserToken);

// GET /v1/projects/:proj/devices/:id/series?metric=temperature&window=1h
//
// Recent-only. Reads from the Device DO ring buffer. NEVER touches R2.
// See plan §7.2 + invariant #5.
series.get('/', async (c) => {
  const proj = c.req.param('proj')!;
  const deviceId = c.req.param('id')!;
  const metric = c.req.query('metric') ?? null;
  const windowStr = c.req.query('window') ?? '1h';

  const sinceTs = computeSinceTs(windowStr);

  const row = await c.env.DB
    .prepare(`SELECT id FROM devices WHERE id = ? AND project_id = ?`)
    .bind(deviceId, proj)
    .first<{ id: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);

  const stub = c.env.DEVICE_DO.get(c.env.DEVICE_DO.idFromName(deviceId)) as unknown as DeviceDO;
  const points = await stub.getSeries(metric, sinceTs);

  return c.json({ device: deviceId, metric, window: windowStr, points });
});

function computeSinceTs(windowStr: string): number {
  const now = Math.floor(Date.now() / 1000);
  const m = /^(\d+)([smh])$/.exec(windowStr);
  if (!m) return now - 60 * 60; // default 1h
  const n = Number(m[1]);
  const unit = m[2];
  const seconds = unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
  return now - seconds;
}

export default series;
