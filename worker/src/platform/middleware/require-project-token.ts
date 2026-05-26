import { createMiddleware } from 'hono/factory';
import type { Env } from '../../env';
import { extractBearer, lookupProjectToken, touchTokenLastUsed } from '../lib/tokens';

export type ProjectTokenContextVars = {
  projectToken: {
    id: string;
    project_id: string;
  };
};

// Gate: validates Authorization: Bearer <project_token> against project_tokens.
// Touches D1 once per ingest call — the unavoidable cost of HTTP-only hardware.
export const requireProjectToken = createMiddleware<{
  Bindings: Env;
  Variables: ProjectTokenContextVars;
}>(async (c, next) => {
  const token = extractBearer(c.req.raw);
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const row = await lookupProjectToken(c.env, token);
  if (!row) return c.json({ error: 'unauthorized' }, 401);

  c.set('projectToken', { id: row.id, project_id: row.project_id });
  c.executionCtx.waitUntil(touchTokenLastUsed(c.env, 'project', row.id));

  await next();
});
