// Hardware control WebSocket upgrade. A hibernated push channel for cloud→
// hardware writes, forwarded to the Project DO. The bearer token may arrive in
// Authorization OR ?token= (WS clients can't set headers on the upgrade), so it
// can't use the requireProjectToken middleware — auth is done inline here.

import type { Context } from 'hono';
import type { Env } from '../../env';
import { lookupProjectToken, touchTokenLastUsed } from '../../platform/lib/tokens';
import { projectStub } from '../../platform/durable-objects/stubs';

export async function controlWsHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim() || c.req.query('token');
  if (!token) return c.text('unauthorized', 401);
  if (c.req.header('upgrade') !== 'websocket') return c.text('expected websocket', 426);

  const row = await lookupProjectToken(c.env, token);
  if (!row) return c.text('unauthorized', 401);

  c.executionCtx.waitUntil(touchTokenLastUsed(c.env, 'project', row.id));
  return projectStub(c.env, row.project_id).fetch(c.req.raw);
}
