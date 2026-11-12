// Worker entry. The Hono app (all routes + middleware) lives in app.ts; this
// file wraps it in the OAuth 2.1 provider and re-exports the Durable Object /
// Workflow classes the runtime binds by name.
//
// Dual MCP auth: bearer tokens on /v1/mcp (handled inside `app`, for CLI/IDE)
// and OAuth on /v1/mcp/oauth (apiRoute below, for claude.ai-style connectors).
// The provider serves /v1/oauth/token, /v1/oauth/register, and the .well-known
// discovery docs; /authorize is rendered by `app` (mcp/oauth.ts). The OAuth MCP
// handler 404s when MCP is disabled, matching the bearer path.

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import type { Env } from './env';
import app from './app';
import { NodrixMcpAgent } from './mcp/agent';
import { mcpEnabled } from './mcp/flags';
import { sendHeartbeat } from './platform/lib/usage-stats';
import { clientKey, overLimit } from './platform/middleware/rate-limit';

export { ProjectDO } from './platform/durable-objects/project-do';
export { DashboardDO } from './platform/durable-objects/dashboard-do';
export { SchedulerDO } from './platform/durable-objects/scheduler-do';
export { Provision } from './platform/workflows/provision';
export { NodrixMcpAgent } from './mcp/agent';

const oauthMcpHandler = NodrixMcpAgent.serve('/v1/mcp/oauth');
const apiHandler = {
  fetch: async (request: Request, env: Env, ctx: ExecutionContext): Promise<Response> => {
    if (!(await mcpEnabled(env))) {
      return new Response(JSON.stringify({ error: 'not_found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      });
    }
    return oauthMcpHandler.fetch(request, env, ctx);
  },
};

const oauthProvider = new OAuthProvider({
  apiRoute: '/v1/mcp/oauth',
  apiHandler,
  defaultHandler: app as unknown as ExportedHandler<Env>,
  authorizeEndpoint: '/authorize',
  tokenEndpoint: '/v1/oauth/token',
  clientRegistrationEndpoint: '/v1/oauth/register',
  clientRegistrationTTL: 30 * 24 * 60 * 60,
  scopesSupported: ['mcp:read', 'mcp:manage'],
});

const REGISTER_MAX_BYTES = 16 * 1024;

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// The provider answers client registration before the app (and its middleware)
// runs, so gate it here: MCP must be on, bodies small, and registrations
// throttled per client.
async function guardRegistration(req: Request, env: Env): Promise<Response | null> {
  if (new URL(req.url).pathname !== '/v1/oauth/register') return null;
  if (!(await mcpEnabled(env))) return jsonError(404, 'not_found');
  const len = Number(req.headers.get('content-length'));
  if (!Number.isFinite(len) || len > REGISTER_MAX_BYTES) return jsonError(413, 'payload_too_large');
  if (await overLimit(env, `oauth-register:${clientKey(req)}`, 10, 3600)) return jsonError(429, 'too_many_requests');
  return null;
}

// OAuth provider hardcodes env.OAUTH_KV with no custom-storage option; alias
// it to the single KV binding so wrangler.toml only declares one namespace.
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    (env as { OAUTH_KV: KVNamespace }).OAUTH_KV = env.KV;
    const blocked = await guardRegistration(req, env);
    if (blocked) return blocked;
    return oauthProvider.fetch(req, env, ctx);
  },
  // Daily cron → anonymous usage heartbeat (refresh version/counts/last_seen).
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    sendHeartbeat(env, ctx);
  },
} satisfies ExportedHandler<Env>;
