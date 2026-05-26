// Bridges the transport-agnostic service layer to the Hono HTTP routes: builds a
// service Actor from the session, and maps a thrown ServiceError to the JSON
// error shape the web client expects ({ error, reason? }).

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { isServiceError } from '../services/errors';
import type { Actor } from '../services/context';
import type { SessionUser } from '../middleware/require-session';

export function actorFromSession(user: SessionUser): Actor {
  return { userId: user.id, role: user.role, source: 'http' };
}

// Returns the mapped error Response for a ServiceError; re-throws anything else
// so genuine bugs still surface as 500s.
export function serviceErrorResponse(c: Context, e: unknown): Response {
  if (isServiceError(e)) {
    return c.json(
      e.reason ? { error: e.code, reason: e.reason } : { error: e.code },
      e.status as ContentfulStatusCode
    );
  }
  throw e;
}
