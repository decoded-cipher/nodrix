import { Hono } from 'hono';
import type { Env } from './env';
import { buildAuth } from './auth';
import { ensureMigrated } from './db/auto-migrate';
import { recordAudit } from './lib/audit';
import me from './admin/me';
import projects from './admin/projects';
import variables from './admin/variables';
import tokens from './admin/tokens';
import dashboards from './admin/dashboards';
import automations from './admin/automations';
import integrations from './admin/integrations';
import auditLog from './admin/audit-log';
import authProviders, { publicAuthProviders } from './admin/auth-providers';
import versionInfo from './admin/version';
import sessionsRouter from './admin/sessions';
import telemetry from './device/telemetry';
import control from './device/control';
import events from './device/events';
import readState from './read/state';
import readSeries from './read/series';
import readList from './read/list';
import ws from './dashboard/ws';
import { sha256Hex } from './lib/ids';

export { ProjectDO } from './do/project-do';
export { DashboardDO } from './do/dashboard-do';
export { SchedulerDO } from './do/scheduler-do';
export { Provision } from './workflows/provision';

const app = new Hono<{ Bindings: Env }>();

// Auto-migrate: on the first request after a deploy, apply any pending
// migrations bundled in worker/src/db/migrations.gen.ts. Module-level
// guard inside makes this effectively free after the first successful
// run per isolate. Logged-and-swallowed failures keep request handling
// alive even when the migrator itself is broken.
app.use('*', async (c, next) => {
  try {
    await ensureMigrated(c.env.DB);
  } catch (e) {
    console.error('[migrate] non-fatal:', e);
  }
  await next();
});

app.get('/healthz', (c) => c.json({ ok: true }));
app.get('/v1/version', (c) => c.json({ name: 'nodrix', version: '0.0.0' }));

// Better Auth: signup/login/logout/OAuth callbacks. Public — no session gate.
// Schema is guaranteed by the auto-migrate middleware running before us, so
// Better Auth's tables exist regardless of whether this is a fresh deploy.
// Better Auth handler mounted as a sub-app at /v1/auth. Sub-router routing
// in Hono handles arbitrary nested paths reliably — bare wildcard patterns
// have had quirks with multi-segment callback URLs in past versions.
const authApp = new Hono<{ Bindings: Env }>();
authApp.all('*', async (c) => {
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
app.route('/v1/auth', authApp);

// Public list of enabled OAuth providers (so the login page can render buttons).
app.route('/v1/public/auth-providers', publicAuthProviders);

// Public bootstrap probe — login page shows registration form when true.
// Schema is ensured by the auto-migrate middleware that runs before us.
app.get('/v1/public/bootstrap-status', async (c) => {
  const row = await c.env.DB
    .prepare(`SELECT 1 AS one FROM users LIMIT 1`)
    .first<{ one: number }>();
  return c.json({ bootstrap: row === null });
});

// Admin (session-gated):
app.route('/v1/admin/me', me);
app.route('/v1/admin/sessions', sessionsRouter);
app.route('/v1/admin/auth-providers', authProviders);
app.route('/v1/admin/version', versionInfo);
app.route('/v1/admin/projects', projects);
app.route('/v1/admin/projects/:proj/variables', variables);
app.route('/v1/admin/projects/:proj/dashboards', dashboards);
app.route('/v1/admin/projects/:proj/automations', automations);
app.route('/v1/admin/projects/:proj/integrations', integrations);
app.route('/v1/admin/tokens', tokens);
app.route('/v1/admin/audit-log', auditLog);

// Hardware-facing (Bearer project-token auth, see the route modules):
app.route('/v1/telemetry', telemetry);
app.route('/v1/control', control);
app.route('/v1/events', events);

// Control WebSocket: hibernated push channel for cloud->hardware variable
// writes. Bearer token may arrive in Authorization OR ?token=... (WS clients
// can't set headers on the upgrade request). Routed to the Project DO.
app.get('/v1/control/ws', async (c) => {
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
      `SELECT id AS token_id, project_id
         FROM project_tokens
        WHERE hash = ? AND revoked_at IS NULL`
    )
    .bind(hash)
    .first<{ token_id: string; project_id: string }>();
  if (!row) return c.text('unauthorized', 401);

  c.executionCtx.waitUntil(
    c.env.DB
      .prepare(`UPDATE project_tokens SET last_used_at = ? WHERE id = ?`)
      .bind(Math.floor(Date.now() / 1000), row.token_id)
      .run()
      .then(() => undefined)
      .catch(() => undefined)
  );

  const stub = c.env.PROJECT_DO.get(c.env.PROJECT_DO.idFromName(row.project_id));
  return stub.fetch(c.req.raw);
});

// Public read API (user/API token auth):
app.route('/v1/projects/:proj/variables', readList);
app.route('/v1/projects/:proj/state', readState);
app.route('/v1/projects/:proj/variables/:key/series', readSeries);

// WebSocket: dashboard live feed (session auth).
app.route('/ws', ws);

// SPA fallback.
app.all('*', async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
