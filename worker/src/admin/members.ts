import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession } from '../middleware/require-session';
import { resolveProject, requireProjectAdmin, type ProjectContextVars } from '../middleware/resolve-project';
import { recordAudit } from '../lib/audit';

// Project membership management. Mounted at /v1/admin/projects/:proj/members.
// Admin-only (project admin, or instance owner/admin via the effective-role
// override). Adds EXISTING users by email; inviting brand-new accounts into the
// instance is the owner/admin invite flow.

const members = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

members.use('*', requireSession);
members.use('*', resolveProject);
members.use('*', requireProjectAdmin);

// GET /  — members of this project.
members.get('/', async (c) => {
  const project = c.get('project');
  const rows = await c.env.DB
    .prepare(
      `SELECT u.id AS user_id, u.email, u.name, u.first_name, u.last_name,
              pm.role, pm.added_at
         FROM project_members pm
         JOIN users u ON u.id = pm.user_id
        WHERE pm.project_id = ?
        ORDER BY pm.added_at ASC`
    )
    .bind(project.id)
    .all();
  return c.json({ members: rows.results });
});

// POST /  body: { email, role:'admin'|'viewer' } — share with an EXISTING user.
members.post('/', async (c) => {
  const project = c.get('project');
  const actor = c.get('user');
  const body = await c.req.json<{ email?: string; role?: string }>();

  const email = (body.email ?? '').trim().toLowerCase();
  const role = body.role === 'admin' ? 'admin' : body.role === 'viewer' ? 'viewer' : null;
  if (!email) return c.json({ error: 'bad_request', reason: 'missing_email' }, 400);
  if (!role) return c.json({ error: 'bad_request', reason: 'invalid_role' }, 400);

  const target = await c.env.DB.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first<{ id: string }>();
  if (!target) {
    // No account yet — caller should use the invite flow (with this project
    // pre-assigned) to bring a new person onto the instance.
    return c.json({ error: 'user_not_found', reason: 'invite_required' }, 404);
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare(
      `INSERT INTO project_members (user_id, project_id, role, added_at, added_by)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, project_id) DO UPDATE SET role = excluded.role`
    )
    .bind(target.id, project.id, role, now, actor.id)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: actor.id,
      action: 'member.add',
      targetType: 'user',
      targetId: target.id,
      metadata: { email, role },
    })
  );
  return c.json({ user_id: target.id, email, role }, 201);
});

// PATCH /:userId  body: { role } — change a member's project role.
members.patch('/:userId', async (c) => {
  const project = c.get('project');
  const actor = c.get('user');
  const userId = c.req.param('userId');
  const body = await c.req.json<{ role?: string }>();
  const role = body.role === 'admin' ? 'admin' : body.role === 'viewer' ? 'viewer' : null;
  if (!role) return c.json({ error: 'bad_request', reason: 'invalid_role' }, 400);

  const res = await c.env.DB
    .prepare(`UPDATE project_members SET role = ? WHERE user_id = ? AND project_id = ?`)
    .bind(role, userId, project.id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: actor.id,
      action: 'member.role_change',
      targetType: 'user',
      targetId: userId,
      metadata: { role },
    })
  );
  return c.json({ user_id: userId, role });
});

// DELETE /:userId — remove a member from this project.
members.delete('/:userId', async (c) => {
  const project = c.get('project');
  const actor = c.get('user');
  const userId = c.req.param('userId');

  const res = await c.env.DB
    .prepare(`DELETE FROM project_members WHERE user_id = ? AND project_id = ?`)
    .bind(userId, project.id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: actor.id,
      action: 'member.remove',
      targetType: 'user',
      targetId: userId,
    })
  );
  return c.body(null, 204);
});

export default members;
