import { createMiddleware } from 'hono/factory';
import type { Env } from '../../env';
import { extractBearer, lookupUserToken, touchTokenLastUsed } from '../lib/tokens';

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
  const token = extractBearer(c.req.raw);
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const row = await lookupUserToken(c.env, token);
  if (!row) return c.json({ error: 'unauthorized' }, 401);

  const proj = c.req.param('proj');
  if (proj && row.project_id && row.project_id !== proj) {
    return c.json({ error: 'forbidden' }, 403);
  }

  c.set('token', { id: row.id, project_id: row.project_id, scope: row.scope });
  c.executionCtx.waitUntil(touchTokenLastUsed(c.env, 'user', row.id));

  await next();
});
