// Best-effort brute-force throttle for the credential endpoints, over KV.
//
// KV is eventually consistent, so this is a soft cap, not a hard quota — a few
// extra attempts can slip through a window, but it stops sustained password
// guessing per IP without a Durable Object. Fails OPEN on any KV hiccup so an
// infra blip never locks legitimate users out. Only the mutating credential
// paths are throttled; session reads (requireSession → getSession) are not.

import { createMiddleware } from 'hono/factory';
import type { Env } from '../../env';

const LIMIT = 10;          // attempts per window per IP
const WINDOW_SEC = 60;

export const authRateLimit = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const credentialPost = c.req.method === 'POST' && (
    path.endsWith('/sign-in/email') ||
    path.endsWith('/sign-up/email') ||
    path.endsWith('/forget-password') ||
    path.endsWith('/reset-password')
  );
  if (!credentialPost) return next();

  const ip = c.req.header('cf-connecting-ip') ?? 'unknown';
  const window = Math.floor(Date.now() / 1000 / WINDOW_SEC);
  const key = `rl:auth:${ip}:${window}`;
  try {
    const current = Number((await c.env.KV.get(key)) ?? '0');
    if (current >= LIMIT) {
      return c.json({ error: 'too_many_requests' }, 429, { 'retry-after': String(WINDOW_SEC) });
    }
    await c.env.KV.put(key, String(current + 1), { expirationTtl: WINDOW_SEC + 5 });
  } catch {
    // KV unavailable — fail open.
  }
  return next();
});
