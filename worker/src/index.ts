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
  scopesSupported: ['mcp:read', 'mcp:manage'],
});

// OAuth provider hardcodes env.OAUTH_KV with no custom-storage option; alias
// it to the single KV binding so wrangler.toml only declares one namespace.
export default {
  fetch(req: Request, env: Env, ctx: ExecutionContext) {
    (env as { OAUTH_KV: KVNamespace }).OAUTH_KV = env.KV;
    return oauthProvider.fetch(req, env, ctx);
  },
} satisfies ExportedHandler<Env>;
