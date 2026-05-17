import { Hono } from 'hono';
import type { Env } from './env';
import { buildAuth } from './auth';
import { isBootstrapped, runMigrations } from './db/migrate';
import { recordAudit } from './lib/audit';
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
import { sha256Hex } from './lib/ids';

export { DeviceDO } from './do/device-do';
export { DashboardDO } from './do/dashboard-do';
export { Provision } from './workflows/provision';

const app = new Hono<{ Bindings: Env }>();

app.get('/healthz', (c) => c.json({ ok: true }));
app.get('/v1/version', (c) => c.json({ name: 'nodrix', version: '0.0.0' }));

// Better Auth: signup/login/logout/OAuth callbacks. Public — no session gate.
// Runs migrations on first call so a fresh deploy can bootstrap directly into
// signup without a separate provisioning step.
// NOTE: `/v1/auth/*` was unreliable in Hono's RegExpRouter — multi-segment
// callback paths like /v1/auth/callback/google fell through to the SPA
// fallback. The explicit named-param + regex catches everything under /v1/auth/.
app.all('/v1/auth/:rest{.+}', async (c) => {
  if (!(await isBootstrapped(c.env.DB))) {
    await runMigrations(c.env.DB);
  }
  const auth = await buildAuth(c.env, c.req.raw);

  const url = new URL(c.req.url);
  const path = url.pathname;
  console.log(`[auth] ${c.req.method} ${path}${url.search}`);

  // Capture the user BEFORE sign-out invalidates the session, so we can
  // emit a user.logout audit entry with the right user_id.
  const isSignOut = path.endsWith('/sign-out');
  let logoutUserId: string | null = null;
  let logoutSessionId: string | null = null;
  if (isSignOut) {
    try {
      const s = await auth.api.getSession({ headers: c.req.raw.headers });
      if (s?.user?.id) {
        logoutUserId = s.user.id;
        logoutSessionId = s.session?.id ?? null;
      }
    } catch { /* no session — nothing to log */ }
  }

  let res: Response;
  try {
    res = await auth.handler(c.req.raw);
  } catch (e) {
    const err = e as Error;
    console.error(`[auth] handler threw on ${path}: ${err.message}\n${err.stack ?? ''}`);
    return c.json({
      error: 'auth_handler_threw',
      message: err.message,
      stack: err.stack,
    }, 500);
  }

  console.log(`[auth] ${c.req.method} ${path} -> ${res.status}`);
  if (res.status >= 400 && res.status < 600) {
    // Body is consumed once — clone to log without breaking the response.
    try {
      const body = await res.clone().text();
      console.error(`[auth] error body: ${body.slice(0, 500)}`);
    } catch { /* ignore */ }
  }
  const loc = res.headers.get('location');
  if (loc) console.log(`[auth] redirect -> ${loc}`);

  if (logoutUserId && res.status < 400) {
    c.executionCtx.waitUntil(
      recordAudit(c.env, {
        projectId: null,
        userId: logoutUserId,
        action: 'user.logout',
        targetType: 'session',
        targetId: logoutSessionId,
      })
    );
  }
  return res;
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

// Device WebSocket: hibernated push channel for commands. Bearer token may
// arrive in Authorization OR ?token=... (WS clients can't set headers on the
// upgrade request). Routed to the Device DO which owns the WS connection.
app.get('/v1/devices/ws', async (c) => {
  const headerToken = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
  const queryToken = c.req.query('token');
  const token = headerToken || queryToken;
  if (!token) return c.text('unauthorized', 401);

  if (c.req.header('upgrade') !== 'websocket') {
    return c.text('expected websocket', 426);
  }

  const hash = await sha256Hex(token);
  const row = await c.env.DB
    .prepare(
      `SELECT t.id AS token_id, d.id AS device_id
         FROM device_tokens t
         JOIN devices d ON d.id = t.device_id
        WHERE t.hash = ? AND t.revoked_at IS NULL`
    )
    .bind(hash)
    .first<{ token_id: string; device_id: string }>();
  if (!row) return c.text('unauthorized', 401);

  c.executionCtx.waitUntil(
    c.env.DB
      .prepare(`UPDATE device_tokens SET last_used_at = ? WHERE id = ?`)
      .bind(Math.floor(Date.now() / 1000), row.token_id)
      .run()
      .then(() => undefined)
      .catch(() => undefined)
  );

  const stub = c.env.DEVICE_DO.get(c.env.DEVICE_DO.idFromName(row.device_id));
  return stub.fetch(c.req.raw);
});

// Public read API (user/API token auth):
app.route('/v1/projects/:proj/devices', readList);
app.route('/v1/projects/:proj/devices/:id/state', readState);
app.route('/v1/projects/:proj/devices/:id/series', readSeries);

// WebSocket: dashboard live feed (session auth).
app.route('/ws', ws);

// SPA fallback.
app.all('*', async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
