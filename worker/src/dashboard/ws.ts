import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess, type AccessContextVars } from '../middleware/require-access';
import { resolveUser, type UserContextVars } from '../middleware/resolve-user';

const ws = new Hono<{ Bindings: Env; Variables: UserContextVars & AccessContextVars }>();

ws.use('*', requireAccess);
ws.use('*', resolveUser);

// GET /ws/:dashboard
// Upgrades to a WebSocket and forwards to the per-dashboard DO.
ws.get('/:dashboard', async (c) => {
  const dashId = c.req.param('dashboard')!;
  const user = c.get('user');

  // Confirm the user has access to the dashboard's project.
  const row = await c.env.DB
    .prepare(
      `SELECT d.id
         FROM dashboards d
         JOIN project_members pm ON pm.project_id = d.project_id
        WHERE d.id = ? AND pm.user_id = ?`
    )
    .bind(dashId, user.id)
    .first<{ id: string }>();
  if (!row) return c.json({ error: 'forbidden' }, 403);

  const upgrade = c.req.header('upgrade');
  if (upgrade !== 'websocket') return c.text('expected websocket', 426);

  const stub = c.env.DASHBOARD_DO.get(c.env.DASHBOARD_DO.idFromName(dashId));
  return stub.fetch(c.req.raw);
});

export default ws;
