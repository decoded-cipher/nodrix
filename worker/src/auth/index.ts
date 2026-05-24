// Better Auth instance, built per-request because:
//   1. Workers have no long-lived process, so there's no "init once" hook.
//   2. OAuth client_id/client_secret live in D1 (auth_providers table) and
//      can change at runtime via the settings UI — building per-request lets
//      saved provider config take effect immediately.
//
// Schema customization: Better Auth's defaults are singular table names and
// camelCase columns. We rename to plural + snake_case to match the rest of
// the codebase. TS API still uses camelCase (e.g. user.emailVerified).

import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { APIError } from 'better-auth/api';
import { drizzle } from 'drizzle-orm/d1';
import type { Env } from '../env';
import * as schema from './schema';
import { recordAudit } from '../lib/audit';
import { decryptSecret } from '../lib/crypto';
import { getOrCreateSigningSecret } from '../lib/auth-secret';
import { findOpenInviteByEmail, consumeInvite } from '../lib/invites';
import { hashPassword as pbkdf2Hash, verifyPassword as pbkdf2Verify } from '../lib/password';

// Shared with admin/auth-providers.ts — encryption info string for OAuth
// client secrets at rest in D1. Changing this invalidates existing rows.
export const OAUTH_SECRET_ENC_INFO = 'oauth-client-secret-v1';

type ProviderRow = {
  kind: 'google' | 'github';
  client_id: string;
  client_secret: string;
  enabled: number;
};

type SocialProviders = {
  google?: { clientId: string; clientSecret: string };
  github?: { clientId: string; clientSecret: string };
};

// OAuth provider config is read on every buildAuth() (i.e. every authenticated
// request). It changes only when an owner edits Settings, so it's KV-cached.
// We cache the RAW rows — secrets stay encrypted at rest in KV exactly as in D1;
// decryption still happens per request (cheap) but the D1 read is skipped.
const PROVIDERS_CACHE_KEY = 'settings:auth_providers';
const PROVIDERS_CACHE_TTL_SECONDS = 300;

async function loadProviderRows(env: Env): Promise<ProviderRow[]> {
  try {
    const cached = await env.KV.get(PROVIDERS_CACHE_KEY);
    if (cached !== null) {
      try { return JSON.parse(cached) as ProviderRow[]; } catch { /* corrupt — refetch */ }
    }
  } catch {
    // KV down — fall through to D1.
  }

  let rows: ProviderRow[] = [];
  try {
    const res = await env.DB
      .prepare(`SELECT kind, client_id, client_secret, enabled FROM auth_providers WHERE enabled = 1`)
      .all<ProviderRow>();
    rows = res.results;
  } catch {
    // Table may not exist yet on a fresh deploy — treat as no providers, but
    // don't cache the empty result (the table is about to be created).
    return [];
  }

  try {
    await env.KV.put(PROVIDERS_CACHE_KEY, JSON.stringify(rows), {
      expirationTtl: PROVIDERS_CACHE_TTL_SECONDS,
    });
  } catch { /* best-effort */ }
  return rows;
}

// Called by the admin auth-providers routes after a write so the next request
// rebuilds from D1 instead of waiting out the TTL.
export async function invalidateAuthProvidersCache(env: Env): Promise<void> {
  try { await env.KV.delete(PROVIDERS_CACHE_KEY); } catch { /* best-effort */ }
}

async function loadProviders(env: Env, signingSecret: string): Promise<SocialProviders> {
  const rows = await loadProviderRows(env);
  const out: SocialProviders = {};
  for (const r of rows) {
    try {
      const clientSecret = await decryptSecret(signingSecret, r.client_secret, OAUTH_SECRET_ENC_INFO);
      out[r.kind] = { clientId: r.client_id, clientSecret };
    } catch {
      // Decrypt failed (corrupted row or signing secret rotated). Skip this
      // provider rather than taking down the whole auth pipeline.
    }
  }
  return out;
}

// baseURL is derived from the request origin so the same code works on
// localhost, *.workers.dev, and custom domains with no env var to set.
// The signing secret is generated on first boot and persisted in
// deployment_settings — see lib/auth-secret.ts.
export async function buildAuth(env: Env, request?: Request) {
  const signingSecret = await getOrCreateSigningSecret(env);
  const socialProviders = await loadProviders(env, signingSecret);
  const db = drizzle(env.DB, { schema });

  const baseURL = request
    ? new URL(request.url).origin
    : 'http://localhost:8787';

  return betterAuth({
    baseURL,
    basePath: '/v1/auth',
    secret: signingSecret,
    trustedOrigins: request ? [new URL(request.url).origin] : undefined,
    database: drizzleAdapter(db, { provider: 'sqlite' }),

    // Without these, Better Auth scopes the session cookie to `Path=/v1/auth`
    // (matching basePath), so the browser doesn't send it on /v1/admin/* or
    // /v1/projects/* and every authenticated API call 401s. Path=/ makes it
    // apply across the whole worker. ipAddressHeaders silences the rate-limit
    // warning Cloudflare Workers triggers since req.ip is undefined.
    advanced: {
      defaultCookieAttributes: {
        path: '/',
        sameSite: 'lax',
        secure: true,
        httpOnly: true,
      },
      ipAddress: {
        ipAddressHeaders: ['cf-connecting-ip'],
      },
    },

    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
      // Hash with PBKDF2 (native Web Crypto, ~tens of ms) instead of Better
      // Auth's default scrypt, which on Workers runs as pure-JS @noble scrypt
      // (~2.5s CPU) and intermittently trips the Worker CPU limit on sign-in
      // (503 exceededCpu).
      password: {
        hash: pbkdf2Hash,
        verify: ({ hash, password }) => pbkdf2Verify(hash, password),
      },
    },

    socialProviders,

    user: {
      modelName: 'users',
      fields: {
        emailVerified: 'email_verified',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      // `role` rides through Better Auth's adapter so the INSERT includes it
      // (column is NOT NULL). input: false prevents users from setting it
      // during signup. The before-hook flips the first user to 'owner'.
      additionalFields: {
        role: {
          type: 'string',
          required: true,
          defaultValue: 'viewer',
          input: false,
        },
      },
    },

    session: {
      modelName: 'sessions',
      fields: {
        userId: 'user_id',
        expiresAt: 'expires_at',
        ipAddress: 'ip_address',
        userAgent: 'user_agent',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      // Long-lived browser sessions; the cookie auto-renews.
      expiresIn: 60 * 60 * 24 * 30,        // 30d
      updateAge: 60 * 60 * 24,             // bump expiry once a day
    },

    account: {
      modelName: 'accounts',
      fields: {
        accountId: 'account_id',
        providerId: 'provider_id',
        userId: 'user_id',
        accessToken: 'access_token',
        refreshToken: 'refresh_token',
        idToken: 'id_token',
        accessTokenExpiresAt: 'access_token_expires_at',
        refreshTokenExpiresAt: 'refresh_token_expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
      // Auto-link OAuth signins to an existing user with the same email.
      // requireLocalEmailVerified:false is REQUIRED here: Better Auth's
      // email/password sign-up stores email_verified=0, and account linking
      // otherwise refuses to link a social login to an "unverified" local
      // account (trustedProviders does NOT bypass that clause) — which made
      // Google sign-in 401 for an existing email/password user. nodrix has no
      // email-verification flow (all emails are treated as verified; new users
      // are created with emailVerified:true in the create hook below), so this
      // is the correct, consistent setting.
      accountLinking: {
        enabled: true,
        trustedProviders: ['google', 'github'],
        requireLocalEmailVerified: false,
      },
    },

    verification: {
      modelName: 'verifications',
      fields: {
        expiresAt: 'expires_at',
        createdAt: 'created_at',
        updatedAt: 'updated_at',
      },
    },

    // Auth lifecycle hooks. Three responsibilities:
    //   • Bootstrap role: first user becomes 'owner', everyone else 'viewer'.
    //   • Profile shape: split `name` → first_name / last_name.
    //   • Audit trail: user.register, user.login (per session create).
    databaseHooks: {
      user: {
        create: {
          // Account creation is gated here for ALL paths (email/password,
          // OAuth first sign-in, and server-side direct-create) — OAuth's
          // createOAuthUser runs these hooks too. After bootstrap, creation is
          // invite-only: an open invite must exist for the email. Role + verified
          // status are assigned from the invite (or owner on bootstrap).
          before: async (user) => {
            const existing = await env.DB
              .prepare(`SELECT 1 AS one FROM users LIMIT 1`)
              .first<{ one: number }>();
            if (!existing) {
              return { data: { ...user, role: 'owner', emailVerified: true } };
            }
            const email = String((user as { email?: string }).email ?? '').toLowerCase();
            const invite = email ? await findOpenInviteByEmail(env, email) : null;
            if (!invite) {
              throw new APIError('FORBIDDEN', {
                message: 'Registration is invite-only on this deployment.',
                code: 'REGISTRATION_CLOSED',
              });
            }
            // Invites only carry the instance role; project assignment happens
            // later from the Users page.
            return { data: { ...user, role: invite.instance_role, emailVerified: true } };
          },
          after: async (user) => {
            const name = (user.name ?? '').trim();
            if (name) {
              const parts = name.split(/\s+/);
              const firstName = parts[0] ?? null;
              const lastName = parts.length > 1 ? parts.slice(1).join(' ') : null;
              await env.DB
                .prepare(`UPDATE users SET first_name = ?, last_name = ? WHERE id = ?`)
                .bind(firstName, lastName, user.id)
                .run();
            }
            // Consume the matching invite (if any): apply its pre-assigned
            // project memberships, then delete it. Role was applied at INSERT by
            // the before-hook. Bootstrap owner has no invite → no-op.
            const email = (user.email ?? '').toLowerCase();
            if (email) {
              const invite = await findOpenInviteByEmail(env, email);
              if (invite) await consumeInvite(env, invite, user.id);
            }
            await recordAudit(env, {
              projectId: null,
              userId: user.id,
              action: 'user.register',
              targetType: 'user',
              targetId: user.id,
              metadata: { email: user.email },
            });
          },
        },
      },
      session: {
        create: {
          after: async (session) => {
            // Fires for every new session (email/password + OAuth, every
            // device). user_agent / ip are useful for security review.
            const s = session as unknown as {
              id: string;
              userId?: string;
              user_id?: string;
              userAgent?: string | null;
              user_agent?: string | null;
              ipAddress?: string | null;
              ip_address?: string | null;
            };
            const userId = s.userId ?? s.user_id ?? null;
            if (!userId) return;
            await recordAudit(env, {
              projectId: null,
              userId,
              action: 'user.login',
              targetType: 'session',
              targetId: s.id,
              metadata: {
                user_agent: s.userAgent ?? s.user_agent ?? null,
                ip_address: s.ipAddress ?? s.ip_address ?? null,
              },
            });
          },
        },
      },
    },
  });
}

export type Auth = Awaited<ReturnType<typeof buildAuth>>;
