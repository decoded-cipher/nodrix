import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';
import { recordAudit } from '../lib/audit';

const me = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

me.use('*', requireSession);

// GET /v1/admin/me  — return the signed-in user + their projects.
me.get('/', async (c) => {
  const user = c.get('user');

  const fullUser = await c.env.DB
    .prepare(
      `SELECT id, email, role, first_name, last_name, last_login_at, created_at, updated_at
         FROM users WHERE id = ?`
    )
    .bind(user.id)
    .first<{
      id: string;
      email: string;
      role: 'owner' | 'admin' | 'member';
      first_name: string | null;
      last_name: string | null;
      last_login_at: number | null;
      created_at: number;
      updated_at: number;
    }>();

  // Instance owner/admin see every project; members see only the projects
  // they're assigned to. Anyone who sees a project has full control of it.
  const instanceAdmin = user.role === 'owner' || user.role === 'admin';
  const projects = instanceAdmin
    ? await c.env.DB
        .prepare(
          `SELECT p.id, p.name, p.description, p.created_at, p.updated_at, p.archived_at
             FROM projects p
            ORDER BY p.created_at ASC`
        )
        .all()
    : await c.env.DB
        .prepare(
          `SELECT p.id, p.name, p.description, p.created_at, p.updated_at, p.archived_at
             FROM projects p
             JOIN project_members pm ON pm.project_id = p.id
            WHERE pm.user_id = ?
            ORDER BY p.created_at ASC`
        )
        .bind(user.id)
        .all();

  return c.json({ user: fullUser, projects: projects.results });
});

// PATCH /v1/admin/me  body: { first_name?, last_name? }
me.patch('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    first_name?: string | null;
    last_name?: string | null;
  }>();

  const sets: string[] = [];
  const vals: unknown[] = [];
  let nextFirst: string | null = user.first_name;
  let nextLast: string | null = user.last_name;
  if ('first_name' in body) {
    nextFirst = typeof body.first_name === 'string' && body.first_name.trim() ? body.first_name.trim() : null;
    sets.push('first_name = ?'); vals.push(nextFirst);
  }
  if ('last_name' in body) {
    nextLast = typeof body.last_name === 'string' && body.last_name.trim() ? body.last_name.trim() : null;
    sets.push('last_name = ?'); vals.push(nextLast);
  }
  if (sets.length === 0) return c.json({ error: 'bad_request', reason: 'no_fields' }, 400);

  // Keep Better Auth's `name` column in sync with first+last so OAuth flows
  // that read `name` see the user's preferred display value.
  const combined = [nextFirst, nextLast].filter((s): s is string => !!s && !!s.trim()).join(' ');
  sets.push('name = ?'); vals.push(combined || null);

  const now = Math.floor(Date.now() / 1000);
  sets.push('updated_at = ?'); vals.push(now);
  vals.push(user.id);

  await c.env.DB
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'user.update',
      targetType: 'user',
      targetId: user.id,
      metadata: { fields: Object.keys(body) },
    })
  );

  const updated = await c.env.DB
    .prepare(
      `SELECT id, email, role, first_name, last_name, last_login_at, created_at, updated_at
         FROM users WHERE id = ?`
    )
    .bind(user.id)
    .first();
  return c.json(updated);
});

export default me;
