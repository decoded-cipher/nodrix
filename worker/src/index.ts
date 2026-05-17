import { Hono } from 'hono';
import type { Env } from './env';
import me from './admin/me';
import projects from './admin/projects';
import devices from './admin/devices';
import tokens from './admin/tokens';
import dashboards from './admin/dashboards';
import telemetry from './device/telemetry';
import commands from './device/commands';
import readState from './read/state';
import readSeries from './read/series';
import readList from './read/list';
import ws from './dashboard/ws';

export { DeviceDO } from './do/device-do';
export { DashboardDO } from './do/dashboard-do';
export { Provision } from './workflows/provision';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({ ok: true }));
app.get('/v1/version', (c) => c.json({ name: 'nodrix', version: '0.0.0' }));

app.route('/v1/admin/me', me);
app.route('/v1/admin/projects', projects);
app.route('/v1/admin/projects/:proj/devices', devices);
app.route('/v1/admin/projects/:proj/dashboards', dashboards);
app.route('/v1/admin/tokens', tokens);
app.route('/v1/telemetry', telemetry);
app.route('/v1/commands', commands);

// Public read API: user/API token auth, edge-cached state, ring-buffer series.
app.route('/v1/projects/:proj/devices', readList);
app.route('/v1/projects/:proj/devices/:id/state', readState);
app.route('/v1/projects/:proj/devices/:id/series', readSeries);

// WebSocket: dashboard live feed (CF Access auth).
app.route('/ws', ws);

// SPA fallback: anything not matched above is served from the ASSETS binding.
app.all('*', async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
