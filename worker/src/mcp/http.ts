// Bearer-auth MCP endpoint (Streamable HTTP), mounted at /v1/mcp. Resolves the
// token here and hands it to the per-session agent DO as ctx.props so tools are
// scoped to the token. (OAuth-auth MCP lives on /v1/mcp/oauth via index.ts.)

import type { Context } from 'hono';
import type { Env } from '../env';
import { NodrixMcpAgent } from './agent';
import { authenticateMcp, touchToken } from './gate';

const mcpHandler = NodrixMcpAgent.serve('/v1/mcp');

export async function mcpBearerHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await authenticateMcp(c.env, c.req.raw);
  if (auth instanceof Response) return auth;
  c.executionCtx.waitUntil(touchToken(c.env, auth.tokenId));
  (c.executionCtx as unknown as { props?: unknown }).props = auth;
  return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx);
}
