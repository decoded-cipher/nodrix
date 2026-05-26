// Service-layer kernel: the transport-agnostic vocabulary (Actor, ServiceError)
// plus its HTTP binding. Services throw ServiceError and take an Actor; HTTP
// routes and MCP tools translate to their own wire format.

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { SessionUser } from '../middleware/require-session';

// Who is performing a call, independent of how they authenticated. HTTP builds
// this from the Better Auth session; MCP builds it from the token's creator.
export type ActorRole = 'owner' | 'admin' | 'member';
export type Actor = { userId: string; role: ActorRole; source: 'http' | 'mcp' };

export function isInstanceAdmin(actor: Actor): boolean {
  return actor.role === 'owner' || actor.role === 'admin';
}

export type ServiceErrorCode = 'bad_request' | 'unauthorized' | 'forbidden' | 'not_found' | 'conflict';

const STATUS: Record<ServiceErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
};

export class ServiceError extends Error {
  constructor(public code: ServiceErrorCode, message?: string, public reason?: string) {
    super(message ?? code);
    this.name = 'ServiceError';
  }
  get status(): number {
    return STATUS[this.code];
  }
}

export function isServiceError(e: unknown): e is ServiceError {
  return e instanceof ServiceError;
}

export function actorFromSession(user: SessionUser): Actor {
  return { userId: user.id, role: user.role, source: 'http' };
}

// Maps a ServiceError to the JSON error shape the web client expects; re-throws
// anything else so genuine bugs still surface as 500s.
export function serviceErrorResponse(c: Context, e: unknown): Response {
  if (isServiceError(e)) {
    return c.json(
      e.reason ? { error: e.code, reason: e.reason } : { error: e.code },
      e.status as ContentfulStatusCode
    );
  }
  throw e;
}
