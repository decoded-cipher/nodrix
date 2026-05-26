// Bearer-token auth for the MCP endpoint. Reuses the existing user_tokens
// (the same credentials the read API accepts), resolves the token creator's
// instance role, and returns props the agent scopes every tool by. MCP never
// grants more than the human behind the token.

import type { Env } from '../env';
import { extractBearer, lookupUserToken, touchTokenLastUsed } from '../platform/lib/tokens';
import { mcpEnabled } from './flags';
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
