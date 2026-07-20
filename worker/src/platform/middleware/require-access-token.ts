import type { Env } from '../../env';
import type { SessionUser } from './require-session';

type Row = {
  user_id: string | null;
  access_token_expires_at: number;
  email: string;
  role: string;
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  image: string | null;
};

// Resolves an opaque OIDC access token (the app's credential) to the same user
// shape requireSession produces. Looked up in this instance's own token store,
// so a token from another deployment isn't found here.
export async function resolveAccessToken(env: Env, request: Request): Promise<SessionUser | null> {
  const token = request.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!token) return null;

  const row = await env.DB
    .prepare(
      `SELECT t.user_id, t.access_token_expires_at,
              u.email, u.role, u.name, u.first_name, u.last_name, u.image
         FROM oauth_access_tokens t
         JOIN users u ON u.id = t.user_id
        WHERE t.access_token = ?`
    )
    .bind(token)
    .first<Row>();
  if (!row || !row.user_id) return null;

  const expRaw = Number(row.access_token_expires_at);
  const expMs = expRaw < 1e12 ? expRaw * 1000 : expRaw;
  if (Number.isFinite(expMs) && expMs < Date.now()) return null;

  return {
    id: row.user_id,
    email: row.email,
    role: (row.role ?? 'member') as SessionUser['role'],
    name: row.name ?? null,
    first_name: row.first_name ?? null,
    last_name: row.last_name ?? null,
    image: row.image ?? null,
  };
}
