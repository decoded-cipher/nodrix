import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';
import { newId, newToken, sha256Hex } from '../lib/ids';
import { recordAudit } from '../lib/audit';

// Invite management — owner/instance-admin only. An invite is a self-serve LINK:
// the invitee sets their own password at /invite/<token>. It binds an email so
// the Better Auth create-gate (auth/index.ts) authorizes the signup. Invites
// onboard a `member` with optional pre-assigned projects; the owner may instead
// invite an `admin` (who reaches every project, so no project selection applies).

const invites = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

invites.use('*', requireSession);
invites.use('*', async (c, next) => {
  const user = c.get('user');
  if (user.role !== 'owner' && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
});

const DEFAULT_EXPIRY_SECONDS = 7 * 24 * 60 * 60; // 7d

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
// body: { email, instance_role?: 'admin' | 'member', project_ids?: string[] }
// Returns a one-time accept link (shown once). Defaults to a member with the
// given project_ids pre-assigned. Only the owner may invite an admin, who
// reaches every project — so project_ids are ignored for admin invites.
invites.post('/', async (c) => {
  const user = c.get('user');
  const body = await c.req.json<{ email?: string; instance_role?: string; project_ids?: unknown }>();

  const email = (body.email ?? '').trim().toLowerCase();
  if (!email || !email.includes('@')) return c.json({ error: 'bad_request', reason: 'invalid_email' }, 400);

  // Only the owner can mint an admin invite; admins can onboard members only.
  const instanceRole: 'admin' | 'member' = body.instance_role === 'admin' ? 'admin' : 'member';
  if (instanceRole === 'admin' && user.role !== 'owner') {
    return c.json({ error: 'forbidden', reason: 'admin_invite_owner_only' }, 403);
  }

  // Admins reach every project, so project pre-assignment only applies to members.
  // Keep only project ids that actually exist (optional).
  let projectIds: string[] = [];
  if (instanceRole === 'member' && Array.isArray(body.project_ids)) {
    const requested = [...new Set(body.project_ids.filter((p): p is string => typeof p === 'string' && p.length > 0))];
    if (requested.length) {
      const projRows = await c.env.DB.prepare(`SELECT id FROM projects`).all<{ id: string }>();
      const valid = new Set(projRows.results.map((r) => r.id));
      projectIds = requested.filter((p) => valid.has(p));
    }
  }

  // Block inviting an email that already has an account — change an existing
  // user's role or project assignments from the Users page instead.
  const existing = await c.env.DB
    .prepare(`SELECT 1 AS one FROM users WHERE email = ? LIMIT 1`)
    .bind(email)
    .first<{ one: number }>();
  if (existing) return c.json({ error: 'conflict', reason: 'user_exists' }, 409);

  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + DEFAULT_EXPIRY_SECONDS;

  const id = newId('token').replace(/^tok_/, 'inv_');
  const token = newToken();
  const tokenHash = await sha256Hex(token);

  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO invites (id, email, instance_role, token_hash, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, email, instanceRole, tokenHash, user.id, now, expiresAt),
    ...projectIds.map((pid) =>
      c.env.DB.prepare(`INSERT INTO invite_projects (invite_id, project_id) VALUES (?, ?)`).bind(id, pid)
    ),
  ]);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'invite.create',
      targetType: 'user',
      targetId: id,
      metadata: { email, instance_role: instanceRole, projects: projectIds.length },
    })
  );

  // One-time accept URL + token (shown once).
  const origin = new URL(c.req.url).origin;
  return c.json(
    { id, email, instance_role: instanceRole, token, url: `${origin}/invite/${token}`, expires_at: expiresAt },
    201
  );
});

// DELETE /v1/admin/invites/:id — revoke a pending invite (deletes the row).
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
