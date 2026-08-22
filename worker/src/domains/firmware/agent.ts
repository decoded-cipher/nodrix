import { Hono, type Context } from 'hono';
import type { Env } from '../../env';
import { requireSession } from '../../platform/middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../../platform/middleware/resolve-project';
import { lookupUserToken, touchTokenLastUsed } from '../../platform/lib/tokens';
import { projectStub } from '../../platform/durable-objects/stubs';
import { recordAudit } from '../../platform/lib/audit';
import { serviceErrorResponse } from '../../platform/lib/service';
import { publishBuild } from './ota';

const MAX_SKETCH_BYTES = 256 * 1024;
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const SAFE_FQBN = /^[A-Za-z0-9_.:-]{1,120}$/;
const SAFE_BUILD_ID = /^bld_[A-Za-z0-9_-]{12}$/;

const ARTIFACT_MAX_AGE_MS = 60 * 60 * 1000;

function artifactKey(projectId: string, buildId: string): string {
  return `builds/${projectId}/${buildId}.bin`;
}

// A build that outran its request still uploads, and nothing will collect it.
async function pruneArtifacts(env: Env, projectId: string): Promise<void> {
  const cutoff = Date.now() - ARTIFACT_MAX_AGE_MS;
  const list = await env.R2.list({ prefix: `builds/${projectId}/` });
  const stale = list.objects.filter((o) => o.uploaded.getTime() < cutoff).map((o) => o.key);
  if (stale.length > 0) await env.R2.delete(stale);
}

// A build runs toolchain work on somebody's physical machine, so not members.
async function authoriseAgent(c: Context<{ Bindings: Env }>): Promise<string | Response> {
  const token = c.req.header('authorization')?.replace(/^Bearer\s+/i, '').trim();
  if (!token) return c.text('unauthorized', 401);

  const row = await lookupUserToken(c.env, token);
  if (!row || row.scope !== 'admin') return c.text('unauthorized', 401);
  if (row.role !== 'owner' && row.role !== 'admin') return c.text('forbidden', 403);

  const projectId = c.req.query('project') ?? row.project_id;
  if (!projectId) return c.text('project required', 400);
  if (row.project_id && row.project_id !== projectId) return c.text('forbidden', 403);

  c.executionCtx.waitUntil(touchTokenLastUsed(c.env, 'user', row.id));
  return projectId;
}

export async function agentWsHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  if (c.req.header('upgrade') !== 'websocket') return c.text('expected websocket', 426);
  const projectId = await authoriseAgent(c);
  if (projectId instanceof Response) return projectId;

  const stub = projectStub(c.env, projectId);
  await stub.setProjectId(projectId);
  return stub.fetch(
    new Request(c.req.raw, { headers: { ...Object.fromEntries(c.req.raw.headers), 'x-nodrix-role': 'agent' } })
  );
}

// Straight to R2 — the DO is also running ingest for every board in the project.
export async function agentArtifactHandler(c: Context<{ Bindings: Env }>): Promise<Response> {
  const projectId = await authoriseAgent(c);
  if (projectId instanceof Response) return projectId;

  const build = c.req.param('build') ?? '';
  if (!SAFE_BUILD_ID.test(build)) return c.text('invalid build id', 400);

  const len = Number(c.req.header('content-length') ?? '0');
  if (!Number.isFinite(len) || len <= 0) return c.text('length required', 411);
  if (len > MAX_ARTIFACT_BYTES) return c.text('artifact too large', 413);
  if (!c.req.raw.body) return c.text('empty body', 400);

  await c.env.R2.put(artifactKey(projectId, build), c.req.raw.body, {
    httpMetadata: { contentType: 'application/octet-stream' },
  });
  return c.body(null, 204);
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

  c.executionCtx.waitUntil(pruneArtifacts(c.env, c.get('project').id).catch(() => {}));

  // Held open until the agent answers — no wall-clock limit while a client waits.
  // The outcome is the last frame of the stream, so this is a 200 either way.
  const stream = await projectStub(c.env, c.get('project').id).requestBuild(fqbn, sketch);
  return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson' } });
});

// Left in place after reading: one build can be flashed over USB and kept for
// OTA. pruneArtifacts sweeps whatever nobody promoted.
build.get('/:id/artifact', async (c) => {
  const user = c.get('user');
  if (user.role !== 'owner' && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

  const id = c.req.param('id');
  if (!SAFE_BUILD_ID.test(id)) return c.json({ error: 'invalid_build' }, 400);

  const key = artifactKey(c.get('project').id, id);
  const object = await c.env.R2.get(key);
  if (!object) return c.json({ error: 'not_found' }, 404);

  return new Response(object.body, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(object.size),
    },
  });
});

// Saving is what makes a build shippable; flashing leaves no trace by design.
build.post('/:id/firmware', async (c) => {
  const user = c.get('user');
  if (user.role !== 'owner' && user.role !== 'admin') return c.json({ error: 'forbidden' }, 403);

  const id = c.req.param('id');
  if (!SAFE_BUILD_ID.test(id)) return c.json({ error: 'invalid_build' }, 400);

  const body = await c.req.json<{ notes?: string }>().catch(() => ({}) as { notes?: string });
  const project = c.get('project');
  try {
    const row = await publishBuild(c.env, project.id, user.id, id, body.notes?.trim() || null);
    await recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'firmware.publish',
      targetType: 'firmware',
      targetId: row.id,
      metadata: { version: row.version, size: row.size },
    });
    return c.json({ firmware: row }, 201);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

export default build;
