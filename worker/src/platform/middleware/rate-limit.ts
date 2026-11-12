// Best-effort per-client throttle over KV.
//
// KV is eventually consistent, so this is a soft cap, not a hard quota. If KV
// errors (outage, exhausted write quota) the count falls back to per-isolate
// memory instead of letting every request through.

import { createMiddleware } from 'hono/factory';
import type { Env } from '../../env';

const LIMIT = 10;          // attempts per window per client
const WINDOW_SEC = 60;

let memoryWindow = 0;
const memory = new Map<string, number>();

// IPv6 clients usually control a whole /64, so count them per /64.
export function clientKey(req: Request): string {
  const ip = req.headers.get('cf-connecting-ip') ?? 'unknown';
  if (!ip.includes(':')) return ip;
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? h : [...h, ...Array(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
  return `${groups.slice(0, 4).join(':')}::/64`;
}

export async function overLimit(env: Env, bucket: string, limit: number, windowSec: number): Promise<boolean> {
  const window = Math.floor(Date.now() / 1000 / windowSec);
  const key = `rl:${bucket}:${window}`;
  try {
    const current = Number((await env.KV.get(key)) ?? '0');
    if (current >= limit) return true;
    await env.KV.put(key, String(current + 1), { expirationTtl: windowSec + 60 });
    return false;
  } catch {
    if (memoryWindow !== window) {
      memory.clear();
      memoryWindow = window;
    }
    const n = (memory.get(key) ?? 0) + 1;
    memory.set(key, n);
    return n > limit;
  }
}

export const authRateLimit = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const path = new URL(c.req.url).pathname;
  const credentialPost = c.req.method === 'POST' && (
    path.endsWith('/sign-in/email') ||
    path.endsWith('/sign-up/email') ||
    path.endsWith('/request-password-reset') ||
    path.endsWith('/reset-password') ||
    path.endsWith('/change-password')
  );
  if (!credentialPost) return next();

  if (await overLimit(c.env, `auth:${clientKey(c.req.raw)}`, LIMIT, WINDOW_SEC)) {
    return c.json({ error: 'too_many_requests' }, 429, { 'retry-after': String(WINDOW_SEC) });
  }
  return next();
});
