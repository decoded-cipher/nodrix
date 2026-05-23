import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';
import { newId, newToken, sha256Hex } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { buildAuth } from '../auth';

// Invite management — owner/instance-admin only. Two flows share the invites
// table: a self-serve LINK (invitee sets their own password at /invite/<token>)
// and DIRECT create (account made now with a temp password). Both bind an email
// so the Better Auth create-gate (auth/index.ts) authorizes the signup.

const invites = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

invites.use('*', requireSession);
invites.use('*', async (c, next) => {
  const user = c.get('user');
  if (user.role !== 'owner' && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
});

const PROJECT_ROLES = new Set(['admin', 'viewer']);
const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7d

type ProjectAssignment = { project_id: string; role: 'admin' | 'viewer' };

function normalizeProjects(raw: unknown): ProjectAssignment[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: ProjectAssignment[] = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const pid = String((p as Record<string, unknown>)['project_id'] ?? '');
    const role = String((p as Record<string, unknown>)['role'] ?? '');
    if (!pid || !PROJECT_ROLES.has(role) || seen.has(pid)) continue;
    seen.add(pid);
    out.push({ project_id: pid, role: role as 'admin' | 'viewer' });
  }
  return out;
}

// GET /v1/admin/invites — pending invites only (a row exists only while pending).
invites.get('/', async (c) => {
  const now = Math.floor(Date.now() / 1000);
  // Self-prune expired rows so the table only holds live invites.
  c.executionCtx.waitUntil(
    c.env.DB
      .prepare(`DELETE FROM invites WHERE expires_at IS NOT NULL AND expires_at <= ?`)
      .bind(now)
      .run()
      .then(() => undefined)
      .catch(() => undefined)
  );

  const rows = await c.env.DB
    .prepare(
      `SELECT i.id, i.email, i.instance_role, i.created_at, i.expires_at,
              u.email AS inviter_email
         FROM invites i
         LEFT JOIN users u ON u.id = i.created_by
        WHERE i.expires_at IS NULL OR i.expires_at > ?
        ORDER BY i.created_at DESC
        LIMIT 200`
    )
    .bind(now)
    .all<{
      id: string;
      email: string | null;
      instance_role: string;
      created_at: number;
      expires_at: number | null;
      inviter_email: string | null;
    }>();
  return c.json({ invites: rows.results });
});

// POST /v1/admin/invites
// body: { email, instance_role:'admin'|'member', projects?, expires_in_days?, mode:'link'|'direct', name? }
invites.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{
    email?: string;
    instance_role?: string;
    projects?: unknown;
    expires_in_days?: number | null;
    mode?: string;
    name?: string | null;
  }>();

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) return c.json({ error: 'bad_request', reason: 'invalid_email' }, 400);

  const instanceRole = body.instance_role === 'admin' ? 'admin' : body.instance_role === 'member' ? 'member' : null;
  if (!instanceRole) return c.json({ error: 'bad_request', reason: 'invalid_role' }, 400);
  // Only the owner may mint instance-admins.
  if (instanceRole === 'admin' && user.role !== 'owner') {
    return c.json({ error: 'forbidden', reason: 'owner_only_admin_invite' }, 403);
  }

  const mode = body.mode === 'direct' ? 'direct' : 'link';
  const projects = normalizeProjects(body.projects);

  // Block inviting an email that already has an account — share an existing user
  // into a project via the project members API instead.
  const existing = await c.env.DB
    .prepare(`SELECT 1 AS one FROM users WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<{ one: number }>();
  if (existing) return c.json({ error: 'conflict', reason: 'user_exists' }, 409);

  const now = Math.floor(Date.now() / 1000);
  const days = typeof body.expires_in_days === 'number' && body.expires_in_days > 0 ? body.expires_in_days : null;
  const expiresAt = days ? now + days * 24 * 60 * 60 : now + DEFAULT_EXPIRY_SECONDS;

  const id = newId('token').replace(/^tok_/, 'inv_');
  const token = newToken();
  const tokenHash = await sha256Hex(token);

  const stmts = [
    c.env.DB
      .prepare(
        `INSERT INTO invites (id, email, instance_role, token_hash, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, email, instanceRole, tokenHash, user.id, now, expiresAt),
    ...projects.map((p) =>
      c.env.DB
        .prepare(`INSERT INTO invite_projects (invite_id, project_id, role) VALUES (?, ?, ?)`)
        .bind(id, p.project_id, p.role)
    ),
  ];
  try {
    await c.env.DB.batch(stmts);
  } catch {
    return c.json({ error: 'bad_request', reason: 'invalid_project' }, 400);
  }

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'invite.create',
      targetType: 'user',
      targetId: id,
      metadata: { email, instance_role: instanceRole, mode, projects: projects.length },
    })
  );

  if (mode === 'direct') {
    // Create the account now with a temp password. The Better Auth create-gate
    // finds this invite by email → authorizes + assigns role; the after-hook
    // consumes it + applies project memberships. We do NOT forward the new
    // user's session — the inviter stays logged in as themselves.
    const tempPassword = newToken();
    const name = (body.name ?? '').trim() || email.split('@')[0]!;
    try {
      const auth = await buildAuth(c.env, c.req.raw);
      await auth.api.signUpEmail({ body: { email, password: tempPassword, name } });
    } catch (e) {
      return c.json({ error: 'signup_failed', reason: (e as Error).message }, 500);
    }
    return c.json({ id, email, instance_role: instanceRole, mode, temp_password: tempPassword }, 201);
  }

  // Link mode: return the one-time accept URL + token (shown once).
  const origin = new URL(c.req.url).origin;
  return c.json(
    { id, email, instance_role: instanceRole, mode, token, url: `${origin}/invite/${token}`, expires_at: expiresAt },
    201
  );
});

// DELETE /v1/admin/invites/:id — revoke a pending invite (deletes the row;
// invite_projects cascade away).
invites.delete('/:id', async (c) => {
  const user = c.get('user');
  const id = c.req.param('id');
  const res = await c.env.DB
    .prepare(`DELETE FROM invites WHERE id = ?`)
    .bind(id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'invite.revoke',
      targetType: 'user',
      targetId: id,
    })
  );
  return c.body(null, 204);
});

export default invites;
