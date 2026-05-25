import { Hono } from 'hono';
import type { Env } from '../env';
import { withEdgeCache } from '../lib/edge-cache';
import {
  validateLayout,
  variablesFromLayout,
  chartVariablesFromLayout,
  type Layout,
} from '../lib/layout';
import type { ProjectDO } from '../do/project-do';

// Public, unauthenticated read of a SHARED dashboard. No session, no token —
// the share_token in the URL is the capability. Every handler resolves the
// token to a dashboard that is BOTH public and not archived, or 404s; nothing
// here ever exposes data outside the shared dashboard's own layout.
//
// Live data is delivered by polling /:token/state (see plan): the public side
// deliberately does NOT touch the Dashboard DO / WebSocket, which stay
// session-gated for members. Both endpoints are edge-cached so a popular embed
// collapses to one origin hit per TTL.

const pub = new Hono<{ Bindings: Env }>();

// Series window shipped to charts, matching the DO snapshot (1h).
const SERIES_WINDOW_SECONDS = 60 * 60;

type DashRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  layout: string;
};

async function resolveShared(env: Env, token: string): Promise<DashRow | null> {
  if (!token) return null;
  return env.DB.prepare(
    `SELECT id, project_id, name, description, layout
       FROM dashboards
      WHERE share_token = ? AND visibility = 'public' AND archived_at IS NULL`
  )
    .bind(token)
    .first<DashRow>();
}

function parseLayout(raw: string): Layout | null {
  try {
    const v = validateLayout(JSON.parse(raw) as unknown);
    return v.ok ? v.value : null;
  } catch {
    return null;
  }
}

// GET /v1/public/dashboards/:token
// The layout to render. Cached longer than state — layouts change rarely.
pub.get('/:token', async (c) => {
  return withEdgeCache(
    c.req.raw,
    async () => {
      const row = await resolveShared(c.env, c.req.param('token'));
      if (!row) return c.json({ error: 'not_found' }, 404);
      const layout = parseLayout(row.layout);
      if (!layout) return c.json({ error: 'invalid_layout' }, 500);
      return c.json({
        id: row.id,
        name: row.name,
        description: row.description,
        project_id: row.project_id,
        layout,
      });
    },
    30
  );
});

// GET /v1/public/dashboards/:token/state
// The polling endpoint: latest value for every variable the layout references,
// plus 1h of series for chart variables only — the exact shape of the DO's
// snapshot { variables, series }, FILTERED to the dashboard's own variables so
// no unrelated project state leaks.
pub.get('/:token/state', async (c) => {
  return withEdgeCache(
    c.req.raw,
    async () => {
      const row = await resolveShared(c.env, c.req.param('token'));
      if (!row) return c.json({ error: 'not_found' }, 404);
      const layout = parseLayout(row.layout);
      if (!layout) return c.json({ error: 'invalid_layout' }, 500);

      const shownVars = new Set(variablesFromLayout(layout));
      const chartVars = chartVariablesFromLayout(layout);
      const since = Math.floor(Date.now() / 1000) - SERIES_WINDOW_SECONDS;

      const stub = c.env.PROJECT_DO.get(
        c.env.PROJECT_DO.idFromName(row.project_id)
      ) as unknown as ProjectDO;

      const [latest, series] = await Promise.all([
        stub.getLatestState().catch(() => []),
        chartVars.length > 0
          ? stub.getSeriesForVariables(chartVars, since).catch(() => [])
          : Promise.resolve([] as Array<{ ts: number; variable: string; value: unknown }>),
      ]);

      const variables: Record<string, { value: unknown; received_at: number }> = {};
      for (const r of latest) {
        if (shownVars.has(r.variable)) {
          variables[r.variable] = { value: r.value, received_at: r.received_at };
        }
      }

      return c.json({ variables, series });
    },
    5
  );
});

export default pub;
