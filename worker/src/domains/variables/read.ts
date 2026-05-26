// Public read API for variables (user/API token auth). Three small Hono apps
// mounted by app.ts at /v1/projects/:proj/{variables, state, variables/:key/series}.

import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireUserToken, type UserTokenContextVars } from '../../platform/middleware/require-user-token';
import { withEdgeCache } from '../../platform/lib/edge-cache';
import { listVariables, getState, getSeries } from './service';

type V = { Bindings: Env; Variables: UserTokenContextVars };

// GET /v1/projects/:proj/variables
export const readList = new Hono<V>();
readList.use('*', requireUserToken);
readList.get('/', async (c) => c.json({ variables: await listVariables(c.env, c.req.param('proj')!) }));

// GET /v1/projects/:proj/state — latest value of every variable. Edge-cached.
export const readState = new Hono<V>();
readState.use('*', requireUserToken);
readState.get('/', async (c) =>
  withEdgeCache(c.req.raw, async () => {
    const proj = c.req.param('proj')!;
    return c.json({ project: proj, state: await getState(c.env, proj) });
  })
);

// GET /v1/projects/:proj/variables/:key/series?window=1h — recent ring buffer
// only (never R2). Edge-cached (short TTL) so repeated polls collapse at the edge.
export const readSeries = new Hono<V>();
readSeries.use('*', requireUserToken);
readSeries.get('/', async (c) =>
  withEdgeCache(
    c.req.raw,
    async () => {
      const proj = c.req.param('proj')!;
      const key = c.req.param('key')!;
      const { window, points } = await getSeries(c.env, proj, key, c.req.query('window') ?? '1h');
      return c.json({ project: proj, variable: key, window, points });
    },
    5
  )
);
