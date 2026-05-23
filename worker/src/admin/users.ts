import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';
import { recordAudit } from '../lib/audit';

// Instance user management — owner/admin only. Role changes are owner-only;
// admins can remove members but not the owner or other admins.

const users = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

users.use('*', requireSession);
users.use('*', async (c, next) => {
  const user = c.get('user');
  if (user.role !== 'owner' && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
});

type Row = {
  id: string;
  email: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  role: 'owner' | 'admin' | 'member';
  last_login_at: number | null;
  created_at: number;
};

// GET /v1/admin/users
users.get('/', async (c) => {
  const rows = await c.env.DB
    .prepare(
      `SELECT id, email, name, first_name, last_name, role, last_login_at, created_at
         FROM users ORDER BY created_at ASC`
    )
    .all<Row>();
  return c.json({ users: rows.results });
});

// PATCH /v1/admin/users/:id  body: { role: 'admin'|'member' }  (owner only)
users.patch('/:id', async (c) => {
  const actor = c.get('user');
  if (actor.role !== 'owner') return c.json({ error: 'forbidden', reason: 'owner_only' }, 403);

  const id = c.req.param('id');
  if (id === actor.id) return c.json({ error: 'bad_request', reason: 'cannot_change_self' }, 400);

  const body = await c.req.json<{ role?: string }>();
  const role = body.role === 'admin' ? 'admin' : body.role === 'member' ? 'member' : null;
  if (!role) return c.json({ error: 'bad_request', reason: 'invalid_role' }, 400);

  const target = await c.env.DB.prepare(`SELECT role FROM users WHERE id = ?`).bind(id).first<{ role: string }>();
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (target.role === 'owner') return c.json({ error: 'forbidden', reason: 'cannot_change_owner' }, 403);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`).bind(role, now, id).run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: actor.id,
      action: 'user.role_change',
      targetType: 'user',
      targetId: id,
      metadata: { role },
    })
  );
  return c.json({ id, role });
});

// DELETE /v1/admin/users/:id — cascades sessions/accounts/memberships.
users.delete('/:id', async (c) => {
  const actor = c.get('user');
  const id = c.req.param('id');
  if (id === actor.id) return c.json({ error: 'bad_request', reason: 'cannot_remove_self' }, 400);

  const target = await c.env.DB.prepare(`SELECT role FROM users WHERE id = ?`).bind(id).first<{ role: string }>();
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (target.role === 'owner') return c.json({ error: 'forbidden', reason: 'cannot_remove_owner' }, 403);
  // Admins can only remove plain members.
  if (actor.role === 'admin' && target.role !== 'member') {
    return c.json({ error: 'forbidden', reason: 'admin_can_remove_members_only' }, 403);
  }

  await c.env.DB.prepare(`DELETE FROM users WHERE id = ?`).bind(id).run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: actor.id,
      action: 'user.remove',
      targetType: 'user',
      targetId: id,
    })
  );
  return c.body(null, 204);
});

// POST /v1/admin/users/:id/transfer-ownership  (owner only)
// The single-owner invariant: the new owner is promoted, the old owner becomes admin.
users.post('/:id/transfer-ownership', async (c) => {
  const actor = c.get('user');
  if (actor.role !== 'owner') return c.json({ error: 'forbidden', reason: 'owner_only' }, 403);
  const id = c.req.param('id');
  if (id === actor.id) return c.json({ error: 'bad_request', reason: 'already_owner' }, 400);

  const target = await c.env.DB.prepare(`SELECT id FROM users WHERE id = ?`).bind(id).first<{ id: string }>();
  if (!target) return c.json({ error: 'not_found' }, 404);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE users SET role = 'owner', updated_at = ? WHERE id = ?`).bind(now, id),
    c.env.DB.prepare(`UPDATE users SET role = 'admin', updated_at = ? WHERE id = ?`).bind(now, actor.id),
  ]);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: actor.id,
      action: 'user.transfer_ownership',
      targetType: 'user',
      targetId: id,
    })
  );
  return c.json({ id, role: 'owner' });
});

export default users;
