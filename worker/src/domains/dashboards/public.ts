import { Hono } from 'hono';
import type { Env } from '../../env';
import { withEdgeCache } from '../../platform/lib/edge-cache';
import {
  validateLayout,
  variablesFromLayout,
  chartVariablesFromLayout,
  type Layout,
} from '../../platform/lib/layout';
import { projectStub } from '../../platform/durable-objects/stubs';
import type { CompactSeries } from '../../platform/lib/series';

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
// Cap on points per chart series in a full snapshot. Dense ingest is stride-
// sampled down to this; deltas are never capped (they carry only new points).
const SERIES_MAX_POINTS = 300;

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

// The polling endpoint: latest value for every variable the layout references,
// plus chart-variable series — the compact { variables, series } shape of the
// DO's snapshot, FILTERED to the dashboard's own variables so no unrelated
// project state leaks.
//
// Without `since` it returns the full 1h window (stride-capped). With `since` it
// returns only points newer than that ts (uncapped, tiny) — the steady-state
// delta poll. Clients send a `since` quantized to the refresh cadence so all
// viewers share one edge-cache entry per bucket.
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

      const sinceParam = c.req.query('since');
      const sinceTs = sinceParam !== undefined ? Number(sinceParam) : NaN;
      const isDelta = Number.isFinite(sinceTs);
      const seriesSince = isDelta ? sinceTs : Math.floor(Date.now() / 1000) - SERIES_WINDOW_SECONDS;
      const seriesCap = isDelta ? undefined : SERIES_MAX_POINTS;

      const stub = projectStub(c.env, row.project_id);

      // One DO round trip for both latest state and chart series. Passing [] when
      // there are no charts skips the series query inside the DO.
      const { latest, series } = await stub
        .getDashboardSnapshot(chartVars, seriesSince, seriesCap)
        .catch(() => ({ latest: [], series: {} as CompactSeries }));

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
