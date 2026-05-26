import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession, type UserContextVars } from '../../platform/middleware/require-session';
import { recordAudit } from '../../platform/lib/audit';

const sessions = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

sessions.use('*', requireSession);

// Owner-only: the active-sessions view is a deployment-wide audit of every
// signed-in device across all users.
sessions.use('*', async (c, next) => {
  if (c.get('user').role !== 'owner') return c.json({ error: 'forbidden', reason: 'owner_only' }, 403);
  await next();
});

// GET /v1/admin/sessions — every user's active sessions across all devices.
sessions.get('/', async (c) => {
  const current = c.get('session');
  const now = Math.floor(Date.now() / 1000);

  const rows = await c.env.DB
    .prepare(
      `SELECT s.id, s.user_agent, s.ip_address, s.created_at, s.updated_at, s.expires_at,
              s.user_id, u.email AS user_email, u.first_name, u.last_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.expires_at > ?
        ORDER BY s.updated_at DESC`
    )
    .bind(now)
    .all<{
      id: string;
      user_agent: string | null;
      ip_address: string | null;
      created_at: number;
      updated_at: number;
      expires_at: number;
      user_id: string;
      user_email: string;
      first_name: string | null;
      last_name: string | null;
    }>();

  return c.json({
    sessions: rows.results.map((s) => ({
      id: s.id,
      user_agent: s.user_agent,
      ip_address: s.ip_address,
      created_at: s.created_at,
      last_seen_at: s.updated_at,
      expires_at: s.expires_at,
      current: s.id === current.id,
      user_id: s.user_id,
      user_email: s.user_email,
      first_name: s.first_name,
      last_name: s.last_name,
    })),
  });
});

// DELETE /v1/admin/sessions/:id — revoke any session (sign out a device).
sessions.delete('/:id', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');

  const res = await c.env.DB
    .prepare(`DELETE FROM sessions WHERE id = ?`)
    .bind(sessionId)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'session.revoke',
      targetType: 'session',
      targetId: sessionId,
    })
  );
  return c.body(null, 204);
});

export default sessions;
