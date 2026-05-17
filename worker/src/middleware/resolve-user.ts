import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import type { AccessContextVars } from './require-access';

export type UserContextVars = AccessContextVars & {
  user: { id: string; email: string; role: 'owner' | 'admin' | 'viewer' };
};

// Resolves the authenticated CF Access caller to a row in `users`. 403 if no
// account exists for the email (the bootstrap flow at /v1/admin/me handles
// the first-user case; everything else is a closed door until RBAC ships).
export const resolveUser = createMiddleware<{
  Bindings: Env;
  Variables: UserContextVars;
}>(async (c, next) => {
  const access = c.get('access');
  const row = await c.env.DB
    .prepare(`SELECT id, email, role FROM users WHERE email = ?`)
    .bind(access.email)
    .first<{ id: string; email: string; role: 'owner' | 'admin' | 'viewer' }>();
  if (!row) return c.json({ error: 'forbidden', reason: 'no_account_for_email' }, 403);
  c.set('user', row);
  await next();
});
