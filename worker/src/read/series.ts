import { Hono } from 'hono';
import type { Env } from '../env';
import { requireUserToken, type UserTokenContextVars } from '../middleware/require-user-token';
import type { ProjectDO } from '../do/project-do';

const series = new Hono<{ Bindings: Env; Variables: UserTokenContextVars }>();

series.use('*', requireUserToken);

// GET /v1/projects/:proj/variables/:key/series?window=1h
//
// Recent-only. Reads from the Project DO ring buffer. NEVER touches R2.
series.get('/', async (c) => {
  const proj = c.req.param('proj')!;
  const key = c.req.param('key')!;
  const windowStr = c.req.query('window') ?? '1h';

  const sinceTs = computeSinceTs(windowStr);

  const stub = c.env.PROJECT_DO.get(c.env.PROJECT_DO.idFromName(proj)) as unknown as ProjectDO;
  const points = await stub.getSeries(key, sinceTs);

  return c.json({ project: proj, variable: key, window: windowStr, points });
});

function computeSinceTs(windowStr: string): number {
  const now = Math.floor(Date.now() / 1000);
  const m = /^(\d+)([smh])$/.exec(windowStr);
  if (!m) return now - 60 * 60; // default 1h
  const n = Number(m[1]);
  const unit = m[2];
  const seconds = unit === 'h' ? n * 3600 : unit === 'm' ? n * 60 : n;
  return now - seconds;
}

export default series;
