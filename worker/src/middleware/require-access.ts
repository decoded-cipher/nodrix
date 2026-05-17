import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { verifyAccessJwt, type AccessClaims } from '../auth/cf-access';

export type AccessContextVars = {
  access: AccessClaims;
};

// Gate: any route mounted under this middleware requires a valid CF Access JWT
// (or an X-Dev-Email header in dev mode — see auth/cf-access.ts).
export const requireAccess = createMiddleware<{
  Bindings: Env;
  Variables: AccessContextVars;
}>(async (c, next) => {
  const claims = await verifyAccessJwt(c.req.raw, c.env);
  if (!claims) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  c.set('access', claims);
  await next();
});
