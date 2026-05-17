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
      additionalFields: {
        role: {
          type: ['owner', 'admin', 'viewer'] as const,
          required: true,
          defaultValue: 'viewer',
          input: false,
        },
        first_name: { type: 'string', required: false },
        last_name: { type: 'string', required: false },
        last_login_at: { type: 'number', required: false, input: false },
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

    // Bootstrap: the first signup becomes 'owner'. Everyone else stays 'viewer'
    // until promoted (RBAC ships later).
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const existing = await env.DB
              .prepare(`SELECT 1 AS one FROM users LIMIT 1`)
              .first<{ one: number }>();
            const role = existing ? 'viewer' : 'owner';
            // Split provider-supplied `name` into first/last on first signup
            // so the rest of the UI can use first_name + last_name.
            const name = (user.name ?? '').trim();
            const parts = name.split(/\s+/, 2);
            return {
              data: {
                ...user,
                role,
                first_name: user.first_name ?? parts[0] ?? null,
                last_name: user.last_name ?? parts[1] ?? null,
              },
            };
          },
        },
      },
    },
  });
}

export type Auth = Awaited<ReturnType<typeof buildAuth>>;
