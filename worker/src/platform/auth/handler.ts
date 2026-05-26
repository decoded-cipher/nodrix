// Better Auth HTTP handler: signup/login/logout/OAuth callbacks. Mounted at
// /v1/auth as a sub-app so multi-segment callback paths route reliably. Wraps
// buildAuth() with the user.logout audit entry + optional debug logging.

import { Hono } from 'hono';
import type { Env } from '../../env';
import { buildAuth } from './index';
import { recordAudit } from '../lib/audit';

export const authApp = new Hono<{ Bindings: Env }>();

authApp.all('*', async (c) => {
  const auth = await buildAuth(c.env, c.req.raw);
  const url = new URL(c.req.url);
  const path = url.pathname;
  const debug = Boolean(c.env.NODRIX_DEBUG_AUTH);
  if (debug) console.log(`[auth] ${c.req.method} ${path}${url.search}`);

  // Capture the user before sign-out invalidates the session, for the audit entry.
  let logoutUserId: string | null = null;
  let logoutSessionId: string | null = null;
  if (path.endsWith('/sign-out')) {
    try {
      const s = await auth.api.getSession({ headers: c.req.raw.headers });
      if (s?.user?.id) {
        logoutUserId = s.user.id;
        logoutSessionId = s.session?.id ?? null;
      }
    } catch { /* no session */ }
  }

  let res: Response;
  try {
    res = await auth.handler(c.req.raw);
  } catch (e) {
    const err = e as Error;
    console.error(`[auth] handler threw on ${path}: ${err.message}\n${err.stack ?? ''}`);
    return c.json(debug ? { error: 'auth_handler_threw', message: err.message } : { error: 'internal_error' }, 500);
  }

  if (debug) console.log(`[auth] ${c.req.method} ${path} -> ${res.status}`);
  if (res.status >= 400 && res.status < 600) {
    try { console.error(`[auth] error body: ${(await res.clone().text()).slice(0, 500)}`); } catch { /* ignore */ }
  }
  if (debug) {
    const loc = res.headers.get('location');
    if (loc) console.log(`[auth] redirect -> ${loc}`);
  }

  if (logoutUserId && res.status < 400) {
    c.executionCtx.waitUntil(
      recordAudit(c.env, {
        projectId: null,
        userId: logoutUserId,
        action: 'user.logout',
        targetType: 'session',
        targetId: logoutSessionId,
      })
    );
  }
  return res;
});
