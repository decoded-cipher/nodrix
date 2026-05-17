import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { buildAuth } from '../auth';

export type SessionUser = {
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'viewer';
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  image: string | null;
};

export type SessionContext = {
  id: string;
  token: string;
  expires_at: number;
};

export type UserContextVars = {
  user: SessionUser;
  session: SessionContext;
};

// Resolves the current session via Better Auth. Returns 401 if no valid
// session cookie is present. Populates `user` + `session` context vars used
// downstream by admin route handlers + resolveProject.
export const requireSession = createMiddleware<{
  Bindings: Env;
  Variables: UserContextVars;
}>(async (c, next) => {
  const auth = await buildAuth(c.env, c.req.raw);
  const result = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!result || !result.user || !result.session) {
    return c.json({ error: 'unauthorized' }, 401);
  }

  const u = result.user as unknown as {
    id: string;
    email: string;
    role?: 'owner' | 'admin' | 'viewer';
    name?: string | null;
    first_name?: string | null;
    last_name?: string | null;
    image?: string | null;
  };

  c.set('user', {
    id: u.id,
    email: u.email,
    role: (u.role ?? 'viewer') as SessionUser['role'],
    name: u.name ?? null,
    first_name: u.first_name ?? null,
    last_name: u.last_name ?? null,
    image: u.image ?? null,
  });
  c.set('session', {
    id: result.session.id,
    token: result.session.token,
    expires_at: Math.floor(new Date(result.session.expiresAt).getTime() / 1000),
  });
  await next();
});
