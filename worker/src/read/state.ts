import { Hono } from 'hono';
import type { Env } from '../env';
import { requireUserToken, type UserTokenContextVars } from '../middleware/require-user-token';
import { withEdgeCache } from '../lib/edge-cache';
import type { DeviceDO } from '../do/device-do';

const state = new Hono<{ Bindings: Env; Variables: UserTokenContextVars }>();

state.use('*', requireUserToken);

// GET /v1/projects/:proj/devices/:id/state
// Edge-cached. See plan §7.2 — non-negotiable.
state.get('/', async (c) => {
  return withEdgeCache(c.req.raw, async () => {
    const proj = c.req.param('proj')!;
    const deviceId = c.req.param('id')!;

    // Confirm device is in the project (scoping is enforced by the path).
    const row = await c.env.DB
      .prepare(`SELECT id FROM devices WHERE id = ? AND project_id = ?`)
      .bind(deviceId, proj)
      .first<{ id: string }>();
    if (!row) return c.json({ error: 'not_found' }, 404);

    const stub = c.env.DEVICE_DO.get(c.env.DEVICE_DO.idFromName(deviceId)) as unknown as DeviceDO;
    const latest = await stub.getLatestState();

    const body: Record<string, { value: unknown; received_at: number }> = {};
    for (const r of latest) {
      body[r.metric] = { value: r.value, received_at: r.received_at };
    }
    return c.json({ device: deviceId, state: body });
  });
});

export default state;
