// Single source of truth for the deployment's signing secret. Used for:
//   - Better Auth session cookie signing
//   - HKDF base for at-rest encryption of OAuth client secrets in D1
//
// First-boot bootstrap: on the very first read we generate 32 random bytes and
// persist them to deployment_settings, so subsequent reads are stable. No env
// var or operator setup is required.
//
// Reads after the first are KV-cached by getSetting (5 min TTL), so the
// hot path is at most one KV hit per cache window.

import type { Env } from '../../env';
import { getSetting } from './deployment-settings';

const KEY = 'auth.signing_secret';
const BYTES = 32;

// The signing secret is stable for the life of a deployment, so once resolved we
// keep it in isolate memory — no KV hop on subsequent requests in this isolate.
let cachedSecret: string | null = null;

function generate(): string {
  const buf = crypto.getRandomValues(new Uint8Array(BYTES));
  let s = '';
  for (const b of buf) s += String.fromCharCode(b);
  return btoa(s);
}

export async function getOrCreateSigningSecret(env: Env): Promise<string> {
  if (cachedSecret) return cachedSecret;
  const existing = await getSetting(env, KEY);
  if (existing) {
    cachedSecret = existing;
    return existing;
  }
  // A null above can also be a transient D1 error or a stale cache tombstone,
  // so never overwrite: insert only if absent, then use whatever is stored.
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT INTO deployment_settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO NOTHING`
    )
    .bind(KEY, generate(), now)
    .run();
  const row = await env.DB
    .prepare(`SELECT value FROM deployment_settings WHERE key = ?`)
    .bind(KEY)
    .first<{ value: string }>();
  if (!row?.value) throw new Error('signing secret unavailable');
  try { await env.KV.delete(`settings:${KEY}`); } catch { /* best-effort */ }
  cachedSecret = row.value;
  return row.value;
}
