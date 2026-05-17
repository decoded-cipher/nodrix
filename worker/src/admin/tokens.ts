import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess } from '../middleware/require-access';
import { resolveUser, type UserContextVars } from '../middleware/resolve-user';
import { newId, newToken, sha256Hex } from '../lib/ids';

const tokens = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

tokens.use('*', requireAccess);
tokens.use('*', resolveUser);

// GET /v1/admin/tokens
tokens.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB
    .prepare(
      `SELECT id, project_id, scope, created_at, last_used_at, revoked_at
         FROM user_tokens
        WHERE created_by = ?
        ORDER BY created_at DESC`
    )
    .bind(user.id)
    .all<{
      id: string;
      project_id: string | null;
      scope: string;
      created_at: number;
      last_used_at: number | null;
      revoked_at: number | null;
    }>();
  return c.json({ tokens: rows.results });
});

// POST /v1/admin/tokens  body: { scope: 'read'|'admin', project_id?: string|null }
// Returns the token plaintext ONCE.
tokens.post('/', async (c) => {
  const body = await c.req.json<{ scope?: string; project_id?: string | null }>();
  const scope = body.scope === 'admin' ? 'admin' : body.scope === 'read' ? 'read' : null;
  if (!scope) return c.json({ error: 'bad_request', reason: 'invalid_scope' }, 400);

  const user = c.get('user');

  // If a project_id is given, the user must be a member.
  if (body.project_id) {
    const m = await c.env.DB
      .prepare(`SELECT 1 AS ok FROM project_members WHERE user_id = ? AND project_id = ?`)
      .bind(user.id, body.project_id)
      .first<{ ok: number }>();
    if (!m) return c.json({ error: 'forbidden' }, 403);
  }

  const id = newId('token');
  const token = newToken();
  const hash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB
    .prepare(
      `INSERT INTO user_tokens (id, project_id, scope, hash, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, body.project_id ?? null, scope, hash, user.id, now)
    .run();

  return c.json({ id, scope, project_id: body.project_id ?? null, created_at: now, token }, 201);
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
  return c.json({ id: tokenId, revoked_at: now });
});

export default tokens;
