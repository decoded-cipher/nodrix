import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession, type UserContextVars } from '../../platform/middleware/require-session';
import { userCanAccessProject } from '../../platform/lib/roles';
import { dashboardStub } from '../../platform/durable-objects/stubs';

const ws = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

ws.use('*', requireSession);

// Upgrades to a WebSocket and forwards to the per-dashboard DO.
ws.get('/:dashboard', async (c) => {
  const dashId = c.req.param('dashboard')!;
  const user = c.get('user');

  // Confirm the user has access to the dashboard's project (membership OR the
  // instance owner/admin override — they have no project_members row).
  const dash = await c.env.DB
    .prepare(`SELECT project_id FROM dashboards WHERE id = ?`)
    .bind(dashId)
    .first<{ project_id: string }>();
  if (!dash) return c.json({ error: 'not_found' }, 404);

  if (!(await userCanAccessProject(c.env, user.id, dash.project_id))) {
    return c.json({ error: 'forbidden' }, 403);
  }

  const upgrade = c.req.header('upgrade');
  if (upgrade !== 'websocket') return c.text('expected websocket', 426);

  // Forward to the DO with the authenticated user id stashed in a header so the
  // DO can re-check project access per control frame (handles live removal).
  const headers = new Headers(c.req.raw.headers);
  headers.set('x-nodrix-uid', user.id);
  const fwd = new Request(c.req.raw.url, {
    method: c.req.raw.method,
    headers,
    body: c.req.raw.body,
  });

  return dashboardStub(c.env, dashId).fetch(fwd);
});

export default ws;
