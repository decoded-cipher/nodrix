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
import { drizzle } from 'drizzle-orm/d1';
import type { Env } from '../env';
import * as schema from './schema';
import { recordAudit } from '../lib/audit';

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

async function loadProviders(env: Env): Promise<SocialProviders> {
  try {
    const rows = await env.DB
      .prepare(`SELECT kind, client_id, client_secret, enabled FROM auth_providers WHERE enabled = 1`)
      .all<ProviderRow>();
    const out: SocialProviders = {};
    for (const r of rows.results) {
      out[r.kind] = { clientId: r.client_id, clientSecret: r.client_secret };
    }
    return out;
  } catch {
    // Table may not exist yet on a fresh deploy — fall back to no providers.
    return {};
  }
}

// baseURL is derived from the request origin so the same code works on
// localhost, *.workers.dev, and custom domains with no env var to set.
// The signing secret comes from a Workers Secret (KMS-encrypted) — see
// README "Post-deploy setup".
export async function buildAuth(env: Env, request?: Request) {
  const socialProviders = await loadProviders(env);
  const db = drizzle(env.DB, { schema });

  const baseURL = request
    ? new URL(request.url).origin
    : 'http://localhost:8787';

  return betterAuth({
    baseURL,
    basePath: '/v1/auth',
    secret: env.BETTER_AUTH_SECRET,
    trustedOrigins: request ? [new URL(request.url).origin] : undefined,
    database: drizzleAdapter(db, { provider: 'sqlite' }),

    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
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
          before: async (user) => {
            const existing = await env.DB
              .prepare(`SELECT 1 AS one FROM users LIMIT 1`)
              .first<{ one: number }>();
            return { data: { ...user, role: existing ? 'viewer' : 'owner' } };
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
