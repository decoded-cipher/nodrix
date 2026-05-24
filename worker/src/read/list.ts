import { Hono } from 'hono';
import type { Env } from '../env';
import { requireUserToken, type UserTokenContextVars } from '../middleware/require-user-token';

const list = new Hono<{ Bindings: Env; Variables: UserTokenContextVars }>();

list.use('*', requireUserToken);

// GET /v1/projects/:proj/variables
list.get('/', async (c) => {
  const proj = c.req.param('proj')!;
  const rows = await c.env.DB
    .prepare(
      `SELECT id, key, unit, created_at, updated_at, last_seen
         FROM project_variables
        WHERE project_id = ?
        ORDER BY key ASC`
    )
    .bind(proj)
    .all<{
      id: string;
      key: string;
      unit: string | null;
      created_at: number;
      updated_at: number;
      last_seen: number | null;
    }>();
  return c.json({ variables: rows.results });
});

export default list;
