import { createLocalJWKSet, jwtVerify, type JSONWebKeySet } from 'jose';
import type { Env } from '../env';

export type AccessClaims = {
  email: string;
  sub: string;
};

// CF Access JWT verification with JWKS cached in KV (1h TTL).
//
// Dev bypass: if CF_ACCESS_TEAM_DOMAIN is unset, an X-Dev-Email header is
// accepted as if it were a verified Access JWT. Used by the smoke test and
// local dev so contributors don't need a CF Access setup.
export async function verifyAccessJwt(
  request: Request,
  env: Env
): Promise<AccessClaims | null> {
  if (!env.CF_ACCESS_TEAM_DOMAIN) {
    const dev = request.headers.get('x-dev-email');
    if (dev) return { email: dev, sub: `dev:${dev}` };
    return null;
  }

  const jwt = request.headers.get('cf-access-jwt-assertion');
  if (!jwt) return null;

  try {
    const jwks = await getJwks(env);
    const keySet = createLocalJWKSet(jwks);

    const { payload } = await jwtVerify(jwt, keySet, {
      issuer: `https://${env.CF_ACCESS_TEAM_DOMAIN}`,
      ...(env.CF_ACCESS_AUD ? { audience: env.CF_ACCESS_AUD } : {}),
    });

    const email = typeof payload['email'] === 'string' ? payload['email'] : null;
    const sub = typeof payload.sub === 'string' ? payload.sub : null;
    if (!email || !sub) return null;

    return { email, sub };
  } catch {
    return null;
  }
}

const JWKS_KEY = 'cf-access:jwks';
const JWKS_TTL_SECONDS = 60 * 60; // 1 hour

async function getJwks(env: Env): Promise<JSONWebKeySet> {
  const cached = await env.KV.get(JWKS_KEY, 'json');
  if (cached) return cached as JSONWebKeySet;

  const url = `https://${env.CF_ACCESS_TEAM_DOMAIN}/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 300 } });
  if (!res.ok) throw new Error(`JWKS fetch failed: ${res.status}`);
  const jwks = (await res.json()) as JSONWebKeySet;

  // Best-effort cache; failures here just mean the next request re-fetches.
  await env.KV.put(JWKS_KEY, JSON.stringify(jwks), { expirationTtl: JWKS_TTL_SECONDS });
  return jwks;
}
