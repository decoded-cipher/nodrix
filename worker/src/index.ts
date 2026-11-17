// Worker entry. The Hono app (all routes + middleware) lives in app.ts; this
// file wraps it in the OAuth 2.1 provider and re-exports the Durable Object /
// Workflow classes the runtime binds by name.
//
// MCP lives at /v1/mcp and accepts either an OAuth access token (claude.ai-style
// connectors) or an API token (CLI/IDE). /v1/mcp/oauth is kept as an alias for
// connectors added before the two were merged. The provider serves
// /v1/oauth/token, /v1/oauth/register, and the .well-known discovery docs;
// /authorize is rendered by `app` (mcp/oauth.ts).

import { OAuthProvider } from '@cloudflare/workers-oauth-provider';
import type { Env } from './env';
import app from './app';
import { NodrixMcpAgent } from './mcp/agent';
import { mcpEnabled } from './mcp/flags';
import { authenticateApiToken, touchToken, type McpProps } from './mcp/gate';
import { sendHeartbeat } from './platform/lib/usage-stats';
import { clientKey, overLimit } from './platform/middleware/rate-limit';

export { ProjectDO } from './platform/durable-objects/project-do';
export { DashboardDO } from './platform/durable-objects/dashboard-do';
export { SchedulerDO } from './platform/durable-objects/scheduler-do';
export { Provision } from './platform/workflows/provision';
export { NodrixMcpAgent } from './mcp/agent';

const MCP_ROUTE = '/v1/mcp';
const mcpHandlers = new Map(
  [MCP_ROUTE, `${MCP_ROUTE}/oauth`].map((path) => [path, NodrixMcpAgent.serve(path)])
);

const apiHandler = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> | Response {
    const handler = mcpHandlers.get(new URL(request.url).pathname);
    if (!handler) return jsonError(404, 'not_found');
    const props = (ctx as { props?: McpProps }).props;
    if (props && props.tokenId !== 'oauth') ctx.waitUntil(touchToken(env, props.tokenId));
    return handler.fetch(request, env, ctx);
  },
};

// Every token is bound to the MCP URL it was issued for, and an instance can be
// served on more than one hostname, so there is one provider per origin.
const providers = new Map<string, OAuthProvider<Env>>();

function providerFor(req: Request): OAuthProvider<Env> {
  const origin = new URL(req.url).origin;
  let provider = providers.get(origin);
  if (!provider) {
    const resource = `${origin}${MCP_ROUTE}`;
    provider = new OAuthProvider<Env>({
      apiRoute: MCP_ROUTE,
      apiHandler,
      defaultHandler: app as unknown as ExportedHandler<Env>,
      authorizeEndpoint: '/authorize',
      tokenEndpoint: '/v1/oauth/token',
      clientRegistrationEndpoint: '/v1/oauth/register',
      clientRegistrationTTL: 30 * 24 * 60 * 60,
      clientIdMetadataDocumentEnabled: true,
      scopesSupported: ['mcp:read', 'mcp:manage'],
      resourceMetadata: { resource },
      resolveExternalToken: async ({ token, env }) => {
        const props = await authenticateApiToken(env, token);
        return props ? { props, audience: resource } : null;
      },
    });
    providers.set(origin, provider);
  }
  return provider;
}

const REGISTER_MAX_BYTES = 16 * 1024;

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

// The provider answers these before the app (and its middleware) runs, so gate
// them here: all 404 while MCP is off, and registration is size-capped and
// throttled per client.
async function guardMcp(req: Request, env: Env): Promise<Response | null> {
  const path = new URL(req.url).pathname;
  const isRegister = path === '/v1/oauth/register';
  const isMcp = path === MCP_ROUTE || path.startsWith(`${MCP_ROUTE}/`);
  if (!isRegister && !isMcp && path !== '/v1/oauth/token') return null;
  if (!(await mcpEnabled(env))) return jsonError(404, 'not_found');
  if (!isRegister) return null;
  const len = Number(req.headers.get('content-length'));
  if (!Number.isFinite(len) || len > REGISTER_MAX_BYTES) return jsonError(413, 'payload_too_large');
  if (await overLimit(env, `oauth-register:${clientKey(req)}`, 10, 3600)) return jsonError(429, 'too_many_requests');
  return null;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext) {
    // A copy per request: the provider attaches its per-origin helpers
    // (OAUTH_PROVIDER) to env, and env is shared across requests. OAUTH_KV is
    // aliased to the one KV binding, since the provider has no storage option.
    const reqEnv: Env = { ...env, OAUTH_KV: env.KV };
    const blocked = await guardMcp(req, reqEnv);
    if (blocked) return blocked;
    return providerFor(req).fetch(req, reqEnv, ctx);
  },
  // Daily cron → anonymous usage heartbeat (refresh version/counts/last_seen).
  scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    sendHeartbeat(env, ctx);
  },
} satisfies ExportedHandler<Env>;
