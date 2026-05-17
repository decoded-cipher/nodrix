import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';

const sessions = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

sessions.use('*', requireSession);

// GET /v1/admin/sessions — list the caller's active sessions across devices.
sessions.get('/', async (c) => {
  const user = c.get('user');
  const current = c.get('session');
  const now = Math.floor(Date.now() / 1000);

  const rows = await c.env.DB
    .prepare(
      `SELECT id, user_agent, ip_address, created_at, updated_at, expires_at
         FROM sessions
        WHERE user_id = ? AND expires_at > ?
        ORDER BY updated_at DESC`
    )
    .bind(user.id, now)
    .all<{
      id: string;
      user_agent: string | null;
      ip_address: string | null;
      created_at: number;
      updated_at: number;
      expires_at: number;
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
    })),
  });
});

// DELETE /v1/admin/sessions/:id — revoke a specific session (sign out a device).
sessions.delete('/:id', async (c) => {
  const user = c.get('user');
  const sessionId = c.req.param('id');

  const res = await c.env.DB
    .prepare(`DELETE FROM sessions WHERE id = ? AND user_id = ?`)
    .bind(sessionId, user.id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);
  return c.body(null, 204);
});

export default sessions;
