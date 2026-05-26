import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession, type UserContextVars } from '../../platform/middleware/require-session';
import { recordAudit } from '../../platform/lib/audit';

// Instance user management — owner/admin only. This is the single place access is
// managed: instance role (owner-only) AND project assignments for members.
// owner/admin reach every project implicitly; a member reaches only the projects
// assigned here.

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

// GET /v1/admin/users — every user, each with their assigned projects (empty for
// owner/admin, who reach all projects implicitly).
users.get('/', async (c) => {
  const [usersRes, membersRes] = await Promise.all([
    c.env.DB
      .prepare(
        `SELECT id, email, name, first_name, last_name, role, last_login_at, created_at
           FROM users ORDER BY created_at ASC`
      )
      .all<Row>(),
    c.env.DB
      .prepare(
        `SELECT pm.user_id, pm.project_id, p.name
           FROM project_members pm
           JOIN projects p ON p.id = pm.project_id`
      )
      .all<{ user_id: string; project_id: string; name: string }>(),
  ]);

  const byUser = new Map<string, { id: string; name: string }[]>();
  for (const m of membersRes.results) {
    const list = byUser.get(m.user_id) ?? [];
    list.push({ id: m.project_id, name: m.name });
    byUser.set(m.user_id, list);
  }

  const out = usersRes.results.map((u) => ({ ...u, projects: byUser.get(u.id) ?? [] }));
  return c.json({ users: out });
});

// PATCH /v1/admin/users/:id  body: { role: 'admin'|'member' }
// Role changes always touch the admin tier, so they're owner-only. Promoting to
// admin clears the user's project rows (admins reach all projects implicitly).
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
  const stmts = [c.env.DB.prepare(`UPDATE users SET role = ?, updated_at = ? WHERE id = ?`).bind(role, now, id)];
  // Admins reach all projects implicitly — drop any explicit memberships.
  if (role === 'admin') stmts.push(c.env.DB.prepare(`DELETE FROM project_members WHERE user_id = ?`).bind(id));
  await c.env.DB.batch(stmts);

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

// PUT /v1/admin/users/:id/projects  body: { project_ids: string[] }
// Replace a member's project assignments. owner/admin only. Only valid for
// members — owner/admin reach every project without explicit rows.
users.put('/:id/projects', async (c) => {
  const actor = c.get('user');
  const id = c.req.param('id');

  const target = await c.env.DB.prepare(`SELECT role FROM users WHERE id = ?`).bind(id).first<{ role: string }>();
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (target.role !== 'member') return c.json({ error: 'bad_request', reason: 'not_a_member' }, 400);

  const body = await c.req.json<{ project_ids?: unknown }>();
  const requested = Array.isArray(body.project_ids)
    ? [...new Set(body.project_ids.filter((p): p is string => typeof p === 'string' && p.length > 0))]
    : [];

  // Keep only ids that actually exist.
  const existing = await c.env.DB.prepare(`SELECT id FROM projects`).all<{ id: string }>();
  const valid = new Set(existing.results.map((r) => r.id));
  const projectIds = requested.filter((p) => valid.has(p));

  const now = Math.floor(Date.now() / 1000);
  const stmts = [c.env.DB.prepare(`DELETE FROM project_members WHERE user_id = ?`).bind(id)];
  for (const pid of projectIds) {
    stmts.push(
      c.env.DB
        .prepare(`INSERT INTO project_members (user_id, project_id, added_at, added_by) VALUES (?, ?, ?, ?)`)
        .bind(id, pid, now, actor.id)
    );
  }
  await c.env.DB.batch(stmts);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: actor.id,
      action: 'user.set_projects',
      targetType: 'user',
      targetId: id,
      metadata: { project_ids: projectIds },
    })
  );
  return c.json({ id, project_ids: projectIds });
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
    // New owner reaches all projects implicitly — drop any explicit memberships.
    c.env.DB.prepare(`DELETE FROM project_members WHERE user_id = ?`).bind(id),
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
