import { Hono, type Context } from 'hono';
import type { Env } from '../../env';
import { requireSession } from '../../platform/middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../../platform/middleware/resolve-project';
import { lookupUserToken, touchTokenLastUsed } from '../../platform/lib/tokens';
import { projectStub } from '../../platform/durable-objects/stubs';

const MAX_SKETCH_BYTES = 256 * 1024;
const SAFE_FQBN = /^[A-Za-z0-9_.:-]{1,120}$/;

// A build runs toolchain work on somebody's physical machine, so not members.
export async function agentWsHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return c.text('unauthorized', 401);
  if (c.req.header('upgrade') !== 'websocket') return c.text('expected websocket', 426);

  const row = await lookupUserToken(c.env, token);
  if (!row || row.scope !== 'admin') return c.text('unauthorized', 401);
  if (row.role !== 'owner' && row.role !== 'admin') return c.text('forbidden', 403);

  const projectId = c.req.query('project') ?? row.project_id;
  if (!projectId) return c.text('project required', 400);
  if (row.project_id && row.project_id !== projectId) return c.text('forbidden', 403);

  c.executionCtx.waitUntil(touchTokenLastUsed(c.env, 'user', row.id));
  const stub = projectStub(c.env, projectId);
  await stub.setProjectId(projectId);
  return stub.fetch(
    new Request(c.req.raw, { headers: { ...Object.fromEntries(c.req.raw.headers), 'x-nodrix-role': 'agent' } })
  );
}

const build = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

build.use('*', requireSession);
build.use('*', resolveProject);

build.post('/', async (c) => {
  const user = c.get('user');
  if (user.role !== 'owner' && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<{ fqbn?: string; sketch?: string }>();
  const fqbn = (body.fqbn ?? '').trim();
  const sketch = body.sketch ?? '';
  if (!SAFE_FQBN.test(fqbn)) return c.json({ error: 'invalid_fqbn' }, 400);
  if (!sketch.trim()) return c.json({ error: 'empty_sketch' }, 400);
  if (new TextEncoder().encode(sketch).length > MAX_SKETCH_BYTES) {
    return c.json({ error: 'sketch_too_large' }, 413);
  }

  // Held open until the agent answers — no wall-clock limit while a client waits.
  const result = await projectStub(c.env, c.get('project').id).requestBuild(fqbn, sketch);
  return c.json(result, result.ok ? 200 : 409);
});

export default build;
