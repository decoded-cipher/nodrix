// App assembly: global middleware + route registration. OAuth wrapper and DO
// exports live in index.ts; route wiring in routes.ts.

import { Hono } from 'hono';
import type { Env } from './env';
import { ensureMigrated } from './platform/db/auto-migrate';
import { securityHeaders } from './platform/middleware/security-headers';
import { registerRoutes } from './routes';

const app = new Hono<{ Bindings: Env }>();

app.use('*', securityHeaders);

// First request after a deploy applies pending migrations; guarded + best-effort.
app.use('*', async (c, next) => {
  try {
    await ensureMigrated(c.env.DB);
  } catch (e) {
    console.error('[migrate] non-fatal:', e);
  }
  await next();
});

registerRoutes(app);

export default app;
