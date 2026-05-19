// /v1/admin/update — owner-only endpoints backing the onboarding wizard
// and the Settings → Version & updates "Update now" button.
//
// Flow:
//   1. Owner pastes a Cloudflare API token during onboarding.
//   2. POST /config validates it (GET /accounts), extracts the account_id,
//      AES-GCM encrypts it with BETTER_AUTH_SECRET, stores in D1.
//   3. Later, owner clicks "Update now" in Settings.
//   4. POST /trigger returns a Cloudflare dashboard deep-link to the Worker's
//      Builds tab. Cloudflare doesn't expose a public token-authed endpoint
//      for triggering Workers Builds yet (the dashboard's own "Retry
//      deployment" button uses an internal Global-API-Key-only endpoint),
//      so the owner clicks Retry there. A new build pulls upstream HEAD via
//      scripts/build-from-upstream.sh and redeploys.
//   5. The UI re-fetches the version comparison; when the deployed SHA
//      catches up to upstream, the "Update available" state clears.

import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';
import { getSetting, setSetting } from '../lib/deployment-settings';
import { encryptSecret, decryptSecret } from '../lib/crypto';
import {
  validateToken,
  getBuild,
  CloudflareApiError,
} from '../lib/cloudflare-api';
import { recordAudit } from '../lib/audit';

const update = new Hono<{ Bindings: Env; Variables: UserContextVars }>();
update.use('*', requireSession);

const TOKEN_KEY = 'cf.api_token_enc';
const ACCOUNT_KEY = 'cf.account_id';
const ACCOUNT_NAME_KEY = 'cf.account_name';
const SCRIPT_NAME_KEY = 'cf.script_name';
const LAST_BUILD_KEY = 'cf.last_build_id';
const DISMISSED_AT_KEY = 'onboarding.dismissed_at';

const TOKEN_ENC_INFO = 'cf-api-token-v1';

function ownerOnly(role: string): boolean {
  return role === 'owner';
}

function scriptNameFromHost(host: string): string {
  // Default: derive from <script>.<subdomain>.workers.dev. Falls back to the
  // hardcoded wrangler.toml `name` (nodrix) when the host doesn't match.
  if (host.endsWith('.workers.dev')) {
    const label = host.slice(0, host.indexOf('.'));
    if (label) return label;
  }
  return 'nodrix';
}

// GET /v1/admin/update — current config + onboarding state.
update.get('/', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);

  const [token, accountId, accountName, scriptName, lastBuild, dismissedAt] = await Promise.all([
    getSetting(c.env, TOKEN_KEY),
    getSetting(c.env, ACCOUNT_KEY),
    getSetting(c.env, ACCOUNT_NAME_KEY),
    getSetting(c.env, SCRIPT_NAME_KEY),
    getSetting(c.env, LAST_BUILD_KEY),
    getSetting(c.env, DISMISSED_AT_KEY),
  ]);

  return c.json({
    configured: !!token,
    account_id: accountId,
    account_name: accountName,
    script_name: scriptName,
    last_build_id: lastBuild,
    dismissed_at: dismissedAt ? Number(dismissedAt) : null,
  });
});

// POST /v1/admin/update/config — body: { token }
// Validates the pasted token, extracts account_id, encrypts and stores.
update.post('/config', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<{ token?: string }>();
  const token = (body.token ?? '').trim();
  if (!token) return c.json({ error: 'bad_request', reason: 'missing_token' }, 400);

  let validated: Awaited<ReturnType<typeof validateToken>>;
  try {
    validated = await validateToken(token);
  } catch (e) {
    if (e instanceof CloudflareApiError) {
      return c.json(
        { error: 'token_rejected', status: e.status, details: e.errors },
        400
      );
    }
    return c.json({ error: 'validation_failed', message: (e as Error).message }, 502);
  }

  const enc = await encryptSecret(c.env.BETTER_AUTH_SECRET, token, TOKEN_ENC_INFO);
  const host = new URL(c.req.url).host;
  const scriptName = scriptNameFromHost(host);

  await Promise.all([
    setSetting(c.env, TOKEN_KEY, enc),
    setSetting(c.env, ACCOUNT_KEY, validated.account_id),
    setSetting(c.env, ACCOUNT_NAME_KEY, validated.account_name),
    setSetting(c.env, SCRIPT_NAME_KEY, scriptName),
    // Clear any prior dismissal — onboarding is now done.
    setSetting(c.env, DISMISSED_AT_KEY, null),
  ]);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'update_config.update',
      targetType: 'deployment',
      metadata: { account_id: validated.account_id, script_name: scriptName },
    })
  );

  return c.json({
    configured: true,
    account_id: validated.account_id,
    account_name: validated.account_name,
    script_name: scriptName,
    other_accounts: validated.all.length > 1 ? validated.all : undefined,
  });
});

// DELETE /v1/admin/update/config — owner removes the stored token.
update.delete('/config', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);

  await Promise.all([
    setSetting(c.env, TOKEN_KEY, null),
    setSetting(c.env, ACCOUNT_KEY, null),
    setSetting(c.env, ACCOUNT_NAME_KEY, null),
    setSetting(c.env, SCRIPT_NAME_KEY, null),
    setSetting(c.env, LAST_BUILD_KEY, null),
  ]);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'update_config.delete',
      targetType: 'deployment',
    })
  );

  return c.body(null, 204);
});

// POST /v1/admin/update/dismiss — owner skipped onboarding for now.
update.post('/dismiss', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);
  await setSetting(c.env, DISMISSED_AT_KEY, String(Math.floor(Date.now() / 1000)));
  return c.json({ dismissed_at: Math.floor(Date.now() / 1000) });
});

// POST /v1/admin/update/trigger — return a Cloudflare dashboard deep-link
// pointing at the Worker's Builds tab. Cloudflare doesn't expose a stable
// public API for "retry/trigger a new Workers Build" — the dashboard's own
// "Retry deployment" button calls an internal endpoint that requires Global
// API Key auth (errors with `10405: Method not allowed for this authentication
// scheme` when called with a scoped API token). So we deep-link the owner
// instead. Once Cloudflare ships a public trigger-build endpoint we swap
// this back to a real API call.
update.post('/trigger', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);

  const [accountId, scriptName] = await Promise.all([
    getSetting(c.env, ACCOUNT_KEY),
    getSetting(c.env, SCRIPT_NAME_KEY),
  ]);
  if (!accountId || !scriptName) {
    return c.json({ error: 'not_configured' }, 400);
  }

  const dashboardUrl =
    `https://dash.cloudflare.com/${encodeURIComponent(accountId)}` +
    `/workers/services/view/${encodeURIComponent(scriptName)}/production/builds`;

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'update.trigger',
      targetType: 'deployment',
    })
  );

  return c.json({ dashboard_url: dashboardUrl });
});

// GET /v1/admin/update/status — poll the latest build's state.
update.get('/status', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);

  const [enc, accountId, scriptName, lastBuildId] = await Promise.all([
    getSetting(c.env, TOKEN_KEY),
    getSetting(c.env, ACCOUNT_KEY),
    getSetting(c.env, SCRIPT_NAME_KEY),
    getSetting(c.env, LAST_BUILD_KEY),
  ]);
  if (!enc || !accountId || !scriptName || !lastBuildId) {
    return c.json({ status: 'idle' });
  }

  let token: string;
  try {
    token = await decryptSecret(c.env.BETTER_AUTH_SECRET, enc, TOKEN_ENC_INFO);
  } catch {
    return c.json({ status: 'unknown', error: 'token_decrypt_failed' });
  }

  try {
    const build = await getBuild(token, accountId, scriptName, lastBuildId);
    return c.json({ build_id: build.id, status: build.status, logs_url: build.logs_url });
  } catch (e) {
    if (e instanceof CloudflareApiError) {
      return c.json({ status: 'unknown', error: e.status });
    }
    return c.json({ status: 'unknown', error: (e as Error).message });
  }
});

export default update;
