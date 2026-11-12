// Turns a token's props into a service Actor and resolves which project a tool
// call targets, enforcing the token's scope.

import type { Env } from '../env';
import type { McpProps } from './gate';
import { type Actor, type ActorRole, ServiceError } from '../platform/lib/service';
import { assertProjectAccess } from '../domains/projects/service';

export function actorOf(props: McpProps): Actor {
  return { userId: props.createdBy, role: props.role, source: 'mcp' };
}

// A live MCP session keeps the props it started with, so re-read the
// credential and the creator's current role from D1 before every call.
// Throws once the token is revoked/expired or the user no longer exists.
export async function refreshProps(env: Env, props: McpProps): Promise<void> {
  if (props.tokenId === 'oauth') {
    const u = await env.DB
      .prepare(`SELECT role FROM users WHERE id = ?`)
      .bind(props.createdBy)
      .first<{ role: ActorRole }>();
    if (!u) throw new ServiceError('unauthorized', 'credential is no longer valid');
    props.role = u.role;
    return;
  }
  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB
    .prepare(
      `SELECT t.scope, t.project_id, u.role
         FROM user_tokens t
         JOIN users u ON u.id = t.created_by
        WHERE t.id = ? AND t.revoked_at IS NULL
          AND (t.expires_at IS NULL OR t.expires_at > ?)`
    )
    .bind(props.tokenId, now)
    .first<{ scope: 'read' | 'admin'; project_id: string | null; role: ActorRole }>();
  if (!row) throw new ServiceError('unauthorized', 'credential is no longer valid');
  props.role = row.role;
  props.scope = row.scope;
  props.projectId = row.project_id;
}

// Resolve the target project id, honoring the token's scope:
//  - project-scoped token: locked to its project; a mismatching `project` arg is
//    forbidden, a missing one defaults to it.
//  - all-projects token: `project` is required.
// Either way the creator must still have access to the project.
export async function resolveProjectId(
  env: Env,
  props: McpProps,
  projectArg?: string
): Promise<string> {
  const pid = scopeProjectId(props, projectArg);
  await assertProjectAccess(env, actorOf(props), pid);
  return pid;
}

// Scope mapping only (no DB access check) for write tools — the write services
// authorize internally via assertProjectAccess, so re-checking here would be a
// redundant query. Still enforces the token's project lock.
export function scopeProjectId(props: McpProps, projectArg?: string): string {
  if (props.projectId) {
    if (projectArg && projectArg !== props.projectId) {
      throw new ServiceError('forbidden', 'token is scoped to a different project');
    }
    return props.projectId;
  }
  if (!projectArg) {
    throw new ServiceError('bad_request', 'project is required for an all-projects token', 'missing_project');
  }
  return projectArg;
}
