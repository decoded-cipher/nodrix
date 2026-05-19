// Canonical-host middleware.
//
// Once a custom domain is attached via the Cloudflare dashboard (Workers →
// Settings → Triggers → Custom Domains), this middleware:
//
//   1. Auto-detects it: the first non-*.workers.dev request the Worker sees
//      becomes the canonical hostname (Cloudflare only routes hostnames the
//      owner has explicitly bound, so this is safe).
//
//   2. Redirects *.workers.dev → canonical with 308 + Cache-Control: max-age=300.
//      308 preserves the HTTP method so API requests (POST /v1/telemetry, etc.)
//      survive the redirect.
//
// Exclusions (do NOT redirect):
//   - /v1/auth/callback/*  — OAuth state cookies are per-host; redirecting
//     mid-flow would break the callback. Owner is nudged to register the new
//     callback URL with their OAuth provider.
//   - WebSocket upgrades — WS clients can't follow HTTP redirects. They'll
//     fail loudly on the workers.dev URL once the canonical is set, which is
//     the desired signal that they need to point at the new host.
//
// Owner overrides (PUT /v1/admin/custom-domain) set manual=true; once manual
// the auto-detect path leaves the stored value alone.

import type { Context, Next } from 'hono';
import type { Env } from '../env';
import { getCanonical, setCanonical } from '../lib/deployment-settings';

const WORKERS_DEV_SUFFIX = '.workers.dev';
const REDIRECT_CACHE_SECONDS = 300;

function isWorkersDev(host: string): boolean {
  return host.endsWith(WORKERS_DEV_SUFFIX);
}

function shouldSkipRedirect(c: Context): boolean {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith('/v1/auth/callback/')) return true;
  if (c.req.header('upgrade')?.toLowerCase() === 'websocket') return true;
  return false;
}

// Hostnames the middleware should never store as the canonical, even if we
// somehow receive a request for them. Belt-and-suspenders against odd routing.
function isPlausibleCustomHost(host: string): boolean {
  if (!host) return false;
  if (isWorkersDev(host)) return false;
  if (host === 'localhost' || host.startsWith('127.') || host.startsWith('0.0.0.0')) return false;
  if (host.endsWith('.localhost')) return false;
  // Reject IP-literal hosts (v4 + most v6 shapes). Custom domains are names.
  if (/^\d+\.\d+\.\d+\.\d+(?::\d+)?$/.test(host)) return false;
  if (host.startsWith('[')) return false;
  return true;
}

export async function canonicalHostMiddleware(c: Context<{ Bindings: Env }>, next: Next) {
  const url = new URL(c.req.url);
  const host = url.host;

  const state = await getCanonical(c.env);

  // Auto-detect path: a custom hostname is talking to us and we either have no
  // canonical yet, or have a stale one that wasn't pinned by an owner.
  if (
    isPlausibleCustomHost(host) &&
    state.hostname !== host &&
    !state.manual
  ) {
    // Best-effort; failures must not block the request. waitUntil keeps this
    // off the request critical path even when D1 is slow.
    c.executionCtx.waitUntil(
      setCanonical(c.env, host, { manual: false }).catch(() => undefined)
    );
  }

  // Redirect path: client is on *.workers.dev and we know where to send them.
  if (
    isWorkersDev(host) &&
    state.hostname &&
    !shouldSkipRedirect(c)
  ) {
    const target = new URL(c.req.url);
    target.host = state.hostname;
    return new Response(null, {
      status: 308,
      headers: {
        Location: target.toString(),
        // Cap browser caching at 5 min so detaching the custom domain in CF
        // doesn't leave clients stuck redirecting to a dead host.
        'Cache-Control': `public, max-age=${REDIRECT_CACHE_SECONDS}`,
      },
    });
  }

  await next();
}
