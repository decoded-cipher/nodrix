import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess, type AccessContextVars } from '../middleware/require-access';
import { runMigrations, isBootstrapped } from '../db/migrate';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';

const me = new Hono<{ Bindings: Env; Variables: AccessContextVars }>();

me.use('*', requireAccess);

me.get('/', async (c) => {
  const access = c.get('access');

  // First-run: schema may not exist + users table may be empty.
  // Both conditions handled idempotently here. See plan §10 — this is the
  // ONLY hot-path code that touches provisioning, and it short-circuits on
  // subsequent calls via isBootstrapped().
  const bootstrapped = await isBootstrapped(c.env.DB);
  if (!bootstrapped) {
    await runMigrations(c.env.DB);
    await seedOwner(c.env.DB, access.email);
  } else {
    // Ensure this caller exists as a user; if a new email comes in post-bootstrap
    // it's currently rejected (RBAC invites come later).
    const existing = await c.env.DB
      .prepare('SELECT id FROM users WHERE email = ?')
      .bind(access.email)
      .first<{ id: string }>();
    if (!existing) {
      return c.json({ error: 'forbidden', reason: 'no_account_for_email' }, 403);
    }
  }

  const user = await c.env.DB
    .prepare(
      `SELECT id, email, role, display_name, avatar_url, last_login_at, created_at, updated_at
         FROM users WHERE email = ?`
    )
    .bind(access.email)
    .first<{
      id: string;
      email: string;
      role: string;
      display_name: string | null;
      avatar_url: string | null;
      last_login_at: number | null;
      created_at: number;
      updated_at: number;
    }>();

  const projects = await c.env.DB
    .prepare(
      `SELECT p.id, p.name, p.description, p.icon, p.color,
              p.created_at, p.updated_at, p.archived_at
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
        WHERE pm.user_id = ?
        ORDER BY p.created_at ASC`
    )
    .bind(user!.id)
    .all<{
      id: string;
      name: string;
      description: string | null;
      icon: string | null;
      color: string | null;
      created_at: number;
      updated_at: number;
      archived_at: number | null;
    }>();

  return c.json({
    user,
    projects: projects.results,
  });
});

// PATCH /v1/admin/me  body: { display_name?, avatar_url? }
// Self-service profile edit. Email/role are not editable here — email comes
// from CF Access, role changes need RBAC (not built yet).
me.patch('/', async (c) => {
  const access = c.get('access');
  const body = await c.req.json<{
    display_name?: string | null;
    avatar_url?: string | null;
  }>();

  const existing = await c.env.DB
    .prepare(`SELECT id FROM users WHERE email = ?`)
    .bind(access.email)
    .first<{ id: string }>();
  if (!existing) return c.json({ error: 'forbidden', reason: 'no_account_for_email' }, 403);

  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('display_name' in body) {
    const v = typeof body.display_name === 'string' ? body.display_name.trim() : null;
    sets.push('display_name = ?'); vals.push(v && v.length > 0 ? v : null);
  }
  if ('avatar_url' in body) {
    const v = typeof body.avatar_url === 'string' ? body.avatar_url.trim() : null;
    sets.push('avatar_url = ?'); vals.push(v && v.length > 0 ? v : null);
  }
  if (sets.length === 0) return c.json({ error: 'bad_request', reason: 'no_fields' }, 400);

  const now = Math.floor(Date.now() / 1000);
  sets.push('updated_at = ?'); vals.push(now);
  vals.push(existing.id);

  await c.env.DB
    .prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: existing.id,
      action: 'user.update',
      targetType: 'user',
      targetId: existing.id,
      metadata: { fields: Object.keys(body) },
    })
  );

  const updated = await c.env.DB
    .prepare(
      `SELECT id, email, role, display_name, avatar_url, last_login_at, created_at, updated_at
         FROM users WHERE id = ?`
    )
    .bind(existing.id)
    .first();
  return c.json(updated);
});

async function seedOwner(db: Env['DB'], email: string): Promise<void> {
  const userId = newId('user');
  const projectId = newId('project');
  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db
      .prepare(
        `INSERT INTO users (id, email, role, created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(userId, email, 'owner', now, now, now),
    db
      .prepare(
        `INSERT INTO projects (id, name, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(projectId, 'Default', userId, now, now),
    db
      .prepare(
        `INSERT INTO project_members (user_id, project_id, role, added_at, added_by)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(userId, projectId, 'owner', now, userId),
  ]);
}

export default me;
