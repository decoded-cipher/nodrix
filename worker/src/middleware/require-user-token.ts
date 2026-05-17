import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { sha256Hex } from '../lib/ids';

export type UserTokenContextVars = {
  token: {
    id: string;
    project_id: string | null; // null = all-projects scope
    scope: 'read' | 'admin';
  };
};

// Validates Authorization: Bearer <user_token>. If the path includes a :proj
// param, also enforces that the token's project_id matches (or is null = all).
export const requireUserToken = createMiddleware<{
  Bindings: Env;
  Variables: UserTokenContextVars;
}>(async (c, next) => {
  const authz = c.req.header('authorization');
  if (!authz || !authz.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const token = authz.slice('Bearer '.length).trim();
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const hash = await sha256Hex(token);
  const row = await c.env.DB
    .prepare(
      `SELECT id, project_id, scope FROM user_tokens
        WHERE hash = ? AND revoked_at IS NULL`
    )
    .bind(hash)
    .first<{ id: string; project_id: string | null; scope: 'read' | 'admin' }>();
  if (!row) return c.json({ error: 'unauthorized' }, 401);

  // If the route has :proj, enforce scope match.
  const proj = c.req.param('proj');
  if (proj && row.project_id && row.project_id !== proj) {
    return c.json({ error: 'forbidden' }, 403);
  }

  c.set('token', row);

  // Best-effort: update last_used_at.
  c.executionCtx.waitUntil(
    c.env.DB.prepare(`UPDATE user_tokens SET last_used_at = ? WHERE id = ?`)
      .bind(Math.floor(Date.now() / 1000), row.id)
      .run()
      .then(() => undefined)
      .catch(() => undefined)
  );

  await next();
});
