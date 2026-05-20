import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { sha256Hex } from '../lib/ids';

export type ProjectTokenContextVars = {
  projectToken: {
    id: string;
    project_id: string;
  };
};

// Gate: validates Authorization: Bearer <project_token> against project_tokens.
// Touches D1 once per ingest call — the unavoidable cost of HTTP-only hardware.
// Tokens are SHA-256 at rest.
export const requireProjectToken = createMiddleware<{
  Bindings: Env;
  Variables: ProjectTokenContextVars;
}>(async (c, next) => {
  const authz = c.req.header('authorization');
  if (!authz || !authz.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const token = authz.slice('Bearer '.length).trim();
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const hash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT id AS token_id, project_id
       FROM project_tokens
      WHERE hash = ? AND revoked_at IS NULL`
  )
    .bind(hash)
    .first<{ token_id: string; project_id: string }>();

  if (!row) return c.json({ error: 'unauthorized' }, 401);

  c.set('projectToken', { id: row.token_id, project_id: row.project_id });

  // Best-effort token heartbeat — don't gate the response.
  const now = Math.floor(Date.now() / 1000);
  c.executionCtx.waitUntil(
    c.env.DB
      .prepare(`UPDATE project_tokens SET last_used_at = ? WHERE id = ?`)
      .bind(now, row.token_id)
      .run()
      .then(() => undefined)
      .catch(() => undefined)
  );

  await next();
});
