// One home for token auth + minting, shared by the HTTP middlewares, the control
// WebSocket upgrade, and the MCP gate. Tokens are SHA-256 at rest; only the hash
// is ever stored.

import type { Env } from '../../env';
import { newToken, sha256Hex } from './ids';
import type { ActorRole } from './service';

export function extractBearer(req: Request): string | null {
  const authz = req.headers.get('authorization');
  if (!authz || !authz.startsWith('Bearer ')) return null;
  return authz.slice('Bearer '.length).trim() || null;
}

export type UserTokenRow = {
  id: string;
  project_id: string | null; // null = all-projects scope
  scope: 'read' | 'admin';
  created_by: string;
  role: ActorRole;
};

// Resolve a user/API token to its row + the creator's instance role. Rejects
// revoked, expired, and orphaned-creator tokens.
export async function lookupUserToken(env: Env, token: string): Promise<UserTokenRow | null> {
  const now = Math.floor(Date.now() / 1000);
  const hash = await sha256Hex(token);
  return env.DB
    .prepare(
      `SELECT t.id, t.project_id, t.scope, t.created_by, u.role
         FROM user_tokens t
         JOIN users u ON u.id = t.created_by
        WHERE t.hash = ? AND t.revoked_at IS NULL
          AND (t.expires_at IS NULL OR t.expires_at > ?)`
    )
    .bind(hash, now)
    .first<UserTokenRow>();
}

export type ProjectTokenRow = { id: string; project_id: string };

// Resolve a hardware/project token (used by the device ingress + control WS).
export async function lookupProjectToken(env: Env, token: string): Promise<ProjectTokenRow | null> {
  const hash = await sha256Hex(token);
  return env.DB
    .prepare(`SELECT id, project_id FROM project_tokens WHERE hash = ? AND revoked_at IS NULL`)
    .bind(hash)
    .first<ProjectTokenRow>();
}

const TOKEN_TABLE = { user: 'user_tokens', project: 'project_tokens' } as const;

// Best-effort last_used_at heartbeat — callers wrap this in waitUntil so it never
// gates the response. The table is a fixed enum, never user input.
export function touchTokenLastUsed(env: Env, table: keyof typeof TOKEN_TABLE, id: string): Promise<void> {
  return env.DB
    .prepare(`UPDATE ${TOKEN_TABLE[table]} SET last_used_at = ? WHERE id = ?`)
    .bind(Math.floor(Date.now() / 1000), id)
    .run()
    .then(() => undefined)
    .catch(() => undefined);
}

// Mint a token: returns the plaintext (shown to the user once) and the hash to
// persist. Callers own the INSERT since each token table has its own columns.
export async function generateToken(): Promise<{ token: string; hash: string }> {
  const token = newToken();
  return { token, hash: await sha256Hex(token) };
}
