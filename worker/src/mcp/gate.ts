// API-token auth for MCP. The OAuth provider owns /v1/mcp and calls this for any
// bearer that isn't one of its own access tokens, so the one endpoint accepts
// both. MCP never grants more than the human behind the token.

import type { Env } from '../env';
import { lookupUserToken, touchTokenLastUsed } from '../platform/lib/tokens';
import type { ActorRole } from '../platform/lib/service';

export type McpProps = {
  tokenId: string;
  scope: 'read' | 'admin';
  projectId: string | null; // null = all-projects token
  createdBy: string;
  role: ActorRole;
} & Record<string, unknown>;

// Null on a missing, revoked, or expired token.
export async function authenticateApiToken(env: Env, token: string): Promise<McpProps | null> {
  const row = await lookupUserToken(env, token);
  if (!row) return null;
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
