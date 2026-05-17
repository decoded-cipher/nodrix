import { Hono } from 'hono';
import type { Env } from '../env';
import { requireUserToken, type UserTokenContextVars } from '../middleware/require-user-token';

const list = new Hono<{ Bindings: Env; Variables: UserTokenContextVars }>();

list.use('*', requireUserToken);

// GET /v1/projects/:proj/devices
list.get('/', async (c) => {
  const proj = c.req.param('proj')!;
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, created_at, last_seen
         FROM devices
        WHERE project_id = ?
        ORDER BY created_at ASC`
    )
    .bind(proj)
    .all<{ id: string; name: string; created_at: number; last_seen: number | null }>();
  return c.json({ devices: rows.results });
});

export default list;
