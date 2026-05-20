import { Hono } from 'hono';
import type { Env } from '../env';
import { requireUserToken, type UserTokenContextVars } from '../middleware/require-user-token';
import { withEdgeCache } from '../lib/edge-cache';
import type { ProjectDO } from '../do/project-do';

const state = new Hono<{ Bindings: Env; Variables: UserTokenContextVars }>();

state.use('*', requireUserToken);

// GET /v1/projects/:proj/state
// Latest value of every variable in the project. Edge-cached.
state.get('/', async (c) => {
  return withEdgeCache(c.req.raw, async () => {
    const proj = c.req.param('proj')!;

    const stub = c.env.PROJECT_DO.get(c.env.PROJECT_DO.idFromName(proj)) as unknown as ProjectDO;
    const latest = await stub.getLatestState();

    const body: Record<string, { value: unknown; received_at: number }> = {};
    for (const r of latest) {
      body[r.variable] = { value: r.value, received_at: r.received_at };
    }
    return c.json({ project: proj, state: body });
  });
});

export default state;
