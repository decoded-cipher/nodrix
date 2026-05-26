// Bearer-token auth for the MCP endpoint. Reuses the existing user_tokens
// (the same credentials the read API accepts), resolves the token creator's
// instance role, and returns props the agent scopes every tool by. MCP never
// grants more than the human behind the token.

import type { Env } from '../env';
import { sha256Hex } from '../lib/ids';
import { mcpEnabled } from './flags';
import type { ActorRole } from '../services/context';

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

  const authz = req.headers.get('authorization');
  const token = authz?.startsWith('Bearer ') ? authz.slice(7).trim() : '';
  if (!token) return unauthorized();

  const hash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB
    .prepare(
      `SELECT t.id, t.project_id, t.scope, t.created_by, u.role
         FROM user_tokens t
         JOIN users u ON u.id = t.created_by
        WHERE t.hash = ? AND t.revoked_at IS NULL
          AND (t.expires_at IS NULL OR t.expires_at > ?)`
    )
    .bind(hash, now)
    .first<{
      id: string;
      project_id: string | null;
      scope: 'read' | 'admin';
      created_by: string;
      role: ActorRole | null;
    }>();
  if (!row) return unauthorized();

  return {
    tokenId: row.id,
    scope: row.scope,
    projectId: row.project_id,
    createdBy: row.created_by,
    role: row.role ?? 'member',
  };
}

// Best-effort last_used_at bump; call inside waitUntil.
export async function touchToken(env: Env, tokenId: string): Promise<void> {
  try {
    await env.DB
      .prepare(`UPDATE user_tokens SET last_used_at = ? WHERE id = ?`)
      .bind(Math.floor(Date.now() / 1000), tokenId)
      .run();
  } catch { /* best-effort */ }
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
