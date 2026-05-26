// HTTP route wiring. app.ts calls registerRoutes(app); the OAuth wrapper and DO
// exports live in index.ts. Registration order matters where noted.

import { Hono } from 'hono';
import type { Env } from './env';

import { authApp } from './platform/auth';

// identity
import me from './domains/identity/me';
import sessionsRouter from './domains/identity/sessions';
import usersRouter from './domains/identity/users';
import invitesRouter from './domains/identity/invites';
import tokens from './domains/identity/tokens';
import authProviders, { publicAuthProviders } from './domains/identity/auth-providers';
import publicInvite from './domains/identity/public-invite';

// projects / variables / dashboards / automations / integrations
import projects from './domains/projects/routes';
import variables from './domains/variables/routes';
import { readList, readState, readSeries } from './domains/variables/read';
import dashboards from './domains/dashboards/routes';
import publicDashboards from './domains/dashboards/public';
import { serveDashboardSeo } from './domains/dashboards/seo';
import ws from './domains/dashboards/ws';
import automations from './domains/automations/routes';
import integrations from './domains/integrations/routes';

// telemetry (device ingress)
import telemetry from './domains/telemetry/telemetry';
import control, { controlWsHandler } from './domains/telemetry/control';
import events from './domains/telemetry/events';

// settings
import settingsRouter from './domains/settings/settings';
import versionInfo from './domains/settings/version';
import auditLog from './domains/settings/audit-log';

// mcp
import { mcpBearerHandler } from './mcp/gate';
import oauthRoutes from './mcp/oauth';

type App = Hono<{ Bindings: Env }>;

export function registerRoutes(app: App): void {
  // System / meta
  app.get('/healthz', (c) => c.json({ ok: true }));
  app.get('/v1/version', (c) => c.json({ name: 'nodrix', version: '0.0.0' }));
  app.get('/v1/public/bootstrap-status', async (c) => {
    const row = await c.env.DB.prepare(`SELECT 1 AS one FROM users LIMIT 1`).first<{ one: number }>();
    return c.json({ bootstrap: row === null });
  });

  // Auth + public (no session)
  app.route('/v1/auth', authApp);
  app.route('/v1/public/auth-providers', publicAuthProviders);
  app.route('/v1/public/invite', publicInvite);
  app.route('/v1/public/dashboards', publicDashboards);

  // Admin (session-gated)
  app.route('/v1/admin/me', me);
  app.route('/v1/admin/sessions', sessionsRouter);
  app.route('/v1/admin/auth-providers', authProviders);
  app.route('/v1/admin/version', versionInfo);
  app.route('/v1/admin/users', usersRouter);
  app.route('/v1/admin/settings', settingsRouter);
  app.route('/v1/admin/invites', invitesRouter);
  app.route('/v1/admin/projects', projects);
  app.route('/v1/admin/projects/:proj/variables', variables);
  app.route('/v1/admin/projects/:proj/dashboards', dashboards);
  app.route('/v1/admin/projects/:proj/automations', automations);
  app.route('/v1/admin/projects/:proj/integrations', integrations);
  app.route('/v1/admin/tokens', tokens);
  app.route('/v1/admin/audit-log', auditLog);

  // Device ingress (project-token). /control/ws must precede /control — the
  // /control mount's requireProjectToken would 401 the header-less WS upgrade.
  app.route('/v1/telemetry', telemetry);
  app.get('/v1/control/ws', controlWsHandler);
  app.route('/v1/control', control);
  app.route('/v1/events', events);

  // Public read API (user/API token)
  app.route('/v1/projects/:proj/variables', readList);
  app.route('/v1/projects/:proj/state', readState);
  app.route('/v1/projects/:proj/variables/:key/series', readSeries);

  // MCP (bearer on /v1/mcp; OAuth consent on /authorize)
  app.all('/v1/mcp', mcpBearerHandler);
  app.route('/authorize', oauthRoutes);

  // WebSocket feed, public dashboard SEO, SPA fallback (last)
  app.route('/ws', ws);
  app.get('/share/:token', (c) => serveDashboardSeo(c.env, c.req.raw, c.req.param('token')));
  app.all('*', async (c) => c.env.ASSETS.fetch(c.req.raw));
}
