// Bearer-token auth for the MCP endpoint. Reuses the existing user_tokens
// (the same credentials the read API accepts), resolves the token creator's
// instance role, and returns props the agent scopes every tool by. MCP never
// grants more than the human behind the token.

import type { Context } from 'hono';
import type { Env } from '../env';
import { extractBearer, lookupUserToken, touchTokenLastUsed } from '../platform/lib/tokens';
import { mcpEnabled } from './flags';
import { NodrixMcpAgent } from './agent';
import type { ActorRole } from '../platform/lib/service';

export type McpProps = {
  tokenId: string;
  scope: 'read' | 'admin';
  projectId: string | null; // null = all-projects token
  createdBy: string;
  role: ActorRole;
} & Record<string, unknown>;

// Resolves props on success, or a Response to short-circuit: 404 when MCP is
// disabled (so a disabled server looks absent, not merely forbidden), 401 on a
// missing/revoked/expired token.
export async function authenticateMcp(env: Env, req: Request): Promise<McpProps | Response> {
  if (!(await mcpEnabled(env))) return json({ error: 'not_found' }, 404);

  const token = extractBearer(req);
  if (!token) return unauthorized();

  const row = await lookupUserToken(env, token);
  if (!row) return unauthorized();

  return {
    tokenId: row.id,
    scope: row.scope,
    projectId: row.project_id,
    createdBy: row.created_by,
    role: row.role,
  };
}

// Best-effort last_used_at bump; call inside waitUntil.
export function touchToken(env: Env, tokenId: string): Promise<void> {
  return touchTokenLastUsed(env, 'user', tokenId);
}

const mcpHandler = NodrixMcpAgent.serve('/v1/mcp');

// Bearer MCP endpoint (mounted at /v1/mcp): authenticate, then hand off to the
// per-session agent DO with the resolved props. (OAuth-auth MCP is on
// /v1/mcp/oauth, wired in index.ts.)
export async function mcpBearerHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  const auth = await authenticateMcp(c.env, c.req.raw);
  if (auth instanceof Response) return auth;
  c.executionCtx.waitUntil(touchToken(c.env, auth.tokenId));
  (c.executionCtx as unknown as { props?: unknown }).props = auth;
  return mcpHandler.fetch(c.req.raw, c.env, c.executionCtx);
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: 'unauthorized' }), {
    status: 401,
    headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer' },
  });
}
