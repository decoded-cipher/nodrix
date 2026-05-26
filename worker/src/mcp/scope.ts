// Turns a token's props into a service Actor and resolves which project a tool
// call targets, enforcing the token's scope.

import type { Env } from '../env';
import type { McpProps } from './gate';
import { type Actor, ServiceError } from '../platform/lib/service';
import { assertProjectAccess } from '../domains/projects/service';

export function actorOf(props: McpProps): Actor {
  return { userId: props.createdBy, role: props.role, source: 'mcp' };
}

// Resolve the target project id, honoring the token's scope:
//  - project-scoped token: locked to its project; a mismatching `project` arg is
//    forbidden, a missing one defaults to it.
//  - all-projects token: `project` is required and checked against the creator's
//    access, so it can't enumerate or reach projects the human can't.
export async function resolveProjectId(
  env: Env,
  props: McpProps,
  projectArg?: string
): Promise<string> {
  if (props.projectId) {
    if (projectArg && projectArg !== props.projectId) {
      throw new ServiceError('forbidden', 'token is scoped to a different project');
    }
    return props.projectId;
  }
  if (!projectArg) {
    throw new ServiceError('bad_request', 'project is required for an all-projects token', 'missing_project');
  }
  await assertProjectAccess(env, actorOf(props), projectArg);
  return projectArg;
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
