// Custom-domain admin: GET/PUT/DELETE the canonical hostname.
//
// The canonical-host middleware auto-detects the hostname on first non-
// *.workers.dev hit, so the happy path needs no owner interaction. This
// endpoint exists for the two manual cases:
//   - Owner has multiple custom domains attached and wants to pin a specific
//     one as canonical (PUT sets manual=true; auto-detect won't overwrite it).
//   - Owner detached the custom domain in CF and needs to clear the stored
//     value so *.workers.dev stops redirecting (DELETE).

import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';
import { getCanonical, setCanonical } from '../lib/deployment-settings';
import { recordAudit } from '../lib/audit';

const customDomain = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

customDomain.use('*', requireSession);

function ownerOnly(role: string) {
  return role === 'owner';
}

// Hostname validation: same shape as DNS labels, max 253 chars, at least one
// dot. Rejects IPs, localhost, workers.dev (would create a redirect loop).
function isValidHostname(h: string): boolean {
  if (!h || h.length > 253) return false;
  if (h.endsWith('.workers.dev')) return false;
  if (h === 'localhost' || h.endsWith('.localhost')) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return false;
  if (!h.includes('.')) return false;
  // Each label: 1-63 chars, alphanumeric + hyphen, not starting/ending with hyphen.
  return h.split('.').every((label) =>
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/.test(label)
  );
}

customDomain.get('/', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);

  const state = await getCanonical(c.env);
  return c.json({
    canonical: state.hostname,
    manual: state.manual,
    detected_at: state.detectedAt,
  });
});

// PUT /v1/admin/custom-domain  body: { hostname: string }
// Pins the canonical to a specific hostname (manual=true). Used when the
// owner has multiple custom domains attached and wants to override the
// auto-detection.
customDomain.put('/', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<{ hostname?: string }>();
  const hostname = (body.hostname ?? '').trim().toLowerCase();
  if (!isValidHostname(hostname)) {
    return c.json({ error: 'bad_request', reason: 'invalid_hostname' }, 400);
  }

  await setCanonical(c.env, hostname, { manual: true });

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'custom_domain.update',
      targetType: 'deployment',
      targetId: null,
      metadata: { hostname, manual: true },
    })
  );

  return c.json({ canonical: hostname, manual: true });
});

// DELETE /v1/admin/custom-domain
// Clears the canonical so *.workers.dev stops redirecting. Auto-detect will
// kick back in on the next non-workers.dev hit (since manual=false now).
customDomain.delete('/', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);

  await setCanonical(c.env, null, { manual: false });

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'custom_domain.delete',
      targetType: 'deployment',
      targetId: null,
    })
  );

  return c.body(null, 204);
});

export default customDomain;
