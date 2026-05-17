import { Hono } from 'hono';
import type { Env } from './env';
import { buildAuth } from './auth';
import { isBootstrapped, runMigrations } from './db/migrate';
import me from './admin/me';
import projects from './admin/projects';
import devices from './admin/devices';
import tokens from './admin/tokens';
import dashboards from './admin/dashboards';
import automations from './admin/automations';
import integrations from './admin/integrations';
import auditLog from './admin/audit-log';
import authProviders, { publicAuthProviders } from './admin/auth-providers';
import sessionsRouter from './admin/sessions';
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

// Better Auth: signup/login/logout/OAuth callbacks. Public — no session gate.
// Runs migrations on first call so a fresh deploy can bootstrap directly into
// signup without a separate provisioning step.
app.on(['GET', 'POST'], '/v1/auth/*', async (c) => {
  if (!(await isBootstrapped(c.env.DB))) {
    await runMigrations(c.env.DB);
  }
  const auth = await buildAuth(c.env, c.req.raw);
  return auth.handler(c.req.raw);
});

// Public list of enabled OAuth providers (so the login page can render buttons).
app.route('/v1/public/auth-providers', publicAuthProviders);

// Public bootstrap probe — login page shows registration form when true.
app.get('/v1/public/bootstrap-status', async (c) => {
  if (!(await isBootstrapped(c.env.DB))) {
    await runMigrations(c.env.DB);
  }
  const row = await c.env.DB
    .prepare(`SELECT 1 AS one FROM users LIMIT 1`)
    .first<{ one: number }>();
  return c.json({ bootstrap: row === null });
});

// Admin (session-gated):
app.route('/v1/admin/me', me);
app.route('/v1/admin/sessions', sessionsRouter);
app.route('/v1/admin/auth-providers', authProviders);
app.route('/v1/admin/projects', projects);
app.route('/v1/admin/projects/:proj/devices', devices);
app.route('/v1/admin/projects/:proj/dashboards', dashboards);
app.route('/v1/admin/projects/:proj/automations', automations);
app.route('/v1/admin/projects/:proj/integrations', integrations);
app.route('/v1/admin/tokens', tokens);
app.route('/v1/admin/audit-log', auditLog);

// Device-facing (Bearer token auth, see the route modules):
app.route('/v1/telemetry', telemetry);
app.route('/v1/commands', commands);

// Public read API (user/API token auth):
app.route('/v1/projects/:proj/devices', readList);
app.route('/v1/projects/:proj/devices/:id/state', readState);
app.route('/v1/projects/:proj/devices/:id/series', readSeries);

// WebSocket: dashboard live feed (session auth).
app.route('/ws', ws);

// SPA fallback.
app.all('*', async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
