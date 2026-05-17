import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess, type AccessContextVars } from '../middleware/require-access';
import { runMigrations, isBootstrapped } from '../db/migrate';
import { newId } from '../lib/ids';

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
    .prepare('SELECT id, email, role FROM users WHERE email = ?')
    .bind(access.email)
    .first<{ id: string; email: string; role: string }>();

  const projects = await c.env.DB
    .prepare(
      `SELECT p.id, p.name, p.created_at
       FROM projects p
       JOIN project_members pm ON pm.project_id = p.id
       WHERE pm.user_id = ?
       ORDER BY p.created_at ASC`
    )
    .bind(user!.id)
    .all<{ id: string; name: string; created_at: number }>();

  return c.json({
    user,
    projects: projects.results,
  });
});

async function seedOwner(db: Env['DB'], email: string): Promise<void> {
  const userId = newId('user');
  const projectId = newId('project');
  const now = Math.floor(Date.now() / 1000);

  await db.batch([
    db
      .prepare(
        'INSERT INTO users (id, email, role, created_at) VALUES (?, ?, ?, ?)'
      )
      .bind(userId, email, 'owner', now),
    db
      .prepare(
        'INSERT INTO projects (id, name, created_at) VALUES (?, ?, ?)'
      )
      .bind(projectId, 'Default', now),
    db
      .prepare(
        'INSERT INTO project_members (user_id, project_id, role) VALUES (?, ?, ?)'
      )
      .bind(userId, projectId, 'owner'),
  ]);
}

export default me;
