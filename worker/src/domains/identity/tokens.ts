import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession, type UserContextVars } from '../../platform/middleware/require-session';
import { newId } from '../../platform/lib/ids';
import { generateToken } from '../../platform/lib/tokens';
import { recordAudit } from '../../platform/lib/audit';

const tokens = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

tokens.use('*', requireSession);

// GET /v1/admin/tokens
tokens.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB
    .prepare(
      `SELECT id, project_id, scope, name, created_at, expires_at, last_used_at, revoked_at
         FROM user_tokens
        WHERE created_by = ?
        ORDER BY created_at DESC`
    )
    .bind(user.id)
    .all<{
      id: string;
      project_id: string | null;
      scope: string;
      name: string | null;
      created_at: number;
      expires_at: number | null;
      last_used_at: number | null;
      revoked_at: number | null;
    }>();
  return c.json({ tokens: rows.results });
});

// POST /v1/admin/tokens  body: { scope: 'read'|'admin', project_id?: string|null }
// Returns the token plaintext ONCE.
tokens.post('/', async (c) => {
  const body = await c.req.json<{
    scope?: string;
    project_id?: string | null;
    name?: string | null;
    expires_at?: number | null;
  }>();
  const scope = body.scope === 'admin' ? 'admin' : body.scope === 'read' ? 'read' : null;
  if (!scope) return c.json({ error: 'bad_request', reason: 'invalid_scope' }, 400);

  const user = c.get('user');

  // If a project_id is given, the user must have access to it: owner/admin reach
  // every project; a member must be assigned to it.
  if (body.project_id) {
    const instanceAdmin = user.role === 'owner' || user.role === 'admin';
    if (!instanceAdmin) {
      const m = await c.env.DB
        .prepare(`SELECT 1 AS ok FROM project_members WHERE user_id = ? AND project_id = ?`)
        .bind(user.id, body.project_id)
        .first<{ ok: number }>();
      if (!m) return c.json({ error: 'forbidden' }, 403);
    }
  }

  const id = newId('token');
  const { token, hash } = await generateToken();
  const now = Math.floor(Date.now() / 1000);
  const tokenName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null;
  const expiresAt = typeof body.expires_at === 'number' && body.expires_at > now ? body.expires_at : null;

  await c.env.DB
    .prepare(
      `INSERT INTO user_tokens (id, project_id, scope, name, hash, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, body.project_id ?? null, scope, tokenName, hash, user.id, now, expiresAt)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: body.project_id ?? null,
      userId: user.id,
      action: 'token.create',
      targetType: 'token',
      targetId: id,
      metadata: { scope, name: tokenName },
    })
  );

  return c.json(
    {
      id,
      scope,
      project_id: body.project_id ?? null,
      name: tokenName,
      created_at: now,
      expires_at: expiresAt,
      token,
    },
    201
  );
});

// POST /v1/admin/tokens/:id/revoke
tokens.post('/:id/revoke', async (c) => {
  const user = c.get('user');
  const tokenId = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);
  const res = await c.env.DB
    .prepare(
      `UPDATE user_tokens SET revoked_at = ?
        WHERE id = ? AND created_by = ? AND revoked_at IS NULL`
    )
    .bind(now, tokenId, user.id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'token.revoke',
      targetType: 'token',
      targetId: tokenId,
    })
  );

  return c.json({ id: tokenId, revoked_at: now });
});

export default tokens;
