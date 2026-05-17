import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import { sha256Hex } from '../lib/ids';

export type DeviceContextVars = {
  device: {
    id: string;
    project_id: string;
  };
};

// Gate: validates Authorization: Bearer <device_token> against device_tokens.
// Touches D1 once per ingest call — this is the unavoidable cost of HTTP-only
// devices. Tokens are SHA-256 at rest. Auth cache could be added later if needed.
export const requireDevice = createMiddleware<{
  Bindings: Env;
  Variables: DeviceContextVars;
}>(async (c, next) => {
  const authz = c.req.header('authorization');
  if (!authz || !authz.startsWith('Bearer ')) {
    return c.json({ error: 'unauthorized' }, 401);
  }
  const token = authz.slice('Bearer '.length).trim();
  if (!token) return c.json({ error: 'unauthorized' }, 401);

  const hash = await sha256Hex(token);
  const row = await c.env.DB.prepare(
    `SELECT t.id AS token_id, d.id AS device_id, d.project_id
       FROM device_tokens t
       JOIN devices d ON d.id = t.device_id
      WHERE t.hash = ? AND t.revoked_at IS NULL`
  )
    .bind(hash)
    .first<{ token_id: string; device_id: string; project_id: string }>();

  if (!row) return c.json({ error: 'unauthorized' }, 401);

  c.set('device', { id: row.device_id, project_id: row.project_id });

  // Best-effort token heartbeat — don't gate the response.
  const now = Math.floor(Date.now() / 1000);
  c.executionCtx.waitUntil(
    c.env.DB
      .prepare(`UPDATE device_tokens SET last_used_at = ? WHERE id = ?`)
      .bind(now, row.token_id)
      .run()
      .then(() => undefined)
      .catch(() => undefined)
  );

  await next();
});
