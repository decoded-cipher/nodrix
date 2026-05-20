import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession } from '../middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../middleware/resolve-project';
import { newId, newToken, sha256Hex } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import type { ProjectDO } from '../do/project-do';

const variables = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

variables.use('*', requireSession);
variables.use('*', resolveProject);

// ---- Variables -------------------------------------------------------------

// GET /v1/admin/projects/:proj/variables
variables.get('/', async (c) => {
  const project = c.get('project');
  const rows = await c.env.DB
    .prepare(
      `SELECT id, key, name, unit, created_at, updated_at, last_seen
         FROM project_variables WHERE project_id = ? ORDER BY key ASC`
    )
    .bind(project.id)
    .all<{
      id: string;
      key: string;
      name: string | null;
      unit: string | null;
      created_at: number;
      updated_at: number;
      last_seen: number | null;
    }>();
  return c.json({ variables: rows.results });
});

// POST /v1/admin/projects/:proj/variables  body: { key, name?, unit? }
// Manual declaration (telemetry also auto-creates variables on first sight).
variables.post('/', async (c) => {
  const body = await c.req.json<{ key?: string; name?: string | null; unit?: string | null }>();
  const key = (body.key ?? '').trim();
  if (!key) return c.json({ error: 'bad_request', reason: 'missing_key' }, 400);

  const project = c.get('project');
  const user = c.get('user');
  const id = newId('variable');
  const now = Math.floor(Date.now() / 1000);

  try {
    await c.env.DB
      .prepare(
        `INSERT INTO project_variables (id, project_id, key, name, unit, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(id, project.id, key, body.name ?? null, body.unit ?? null, now, now)
      .run();
  } catch {
    return c.json({ error: 'conflict', reason: 'duplicate_key' }, 409);
  }

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'variable.create',
      targetType: 'variable',
      targetId: id,
      metadata: { key },
    })
  );

  return c.json({ id, key, name: body.name ?? null, unit: body.unit ?? null, created_at: now, updated_at: now }, 201);
});

// PATCH /v1/admin/projects/:proj/variables/:id  body: { name?, unit? }
variables.patch('/:id', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string | null; unit?: string | null }>();

  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('name' in body) { sets.push('name = ?'); vals.push(body.name ?? null); }
  if ('unit' in body) { sets.push('unit = ?'); vals.push(body.unit ?? null); }
  if (sets.length === 0) return c.json({ error: 'bad_request', reason: 'no_fields' }, 400);

  const now = Math.floor(Date.now() / 1000);
  sets.push('updated_at = ?'); vals.push(now);
  vals.push(id, project.id);

  const res = await c.env.DB
    .prepare(`UPDATE project_variables SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`)
    .bind(...vals)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

  const row = await c.env.DB
    .prepare(`SELECT id, key, name, unit, created_at, updated_at, last_seen FROM project_variables WHERE id = ?`)
    .bind(id)
    .first();
  return c.json(row);
});

// DELETE /v1/admin/projects/:proj/variables/:id
// Also clears hot state for the variable in the Project DO.
variables.delete('/:id', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const id = c.req.param('id');

  const v = await c.env.DB
    .prepare(`SELECT key FROM project_variables WHERE id = ? AND project_id = ?`)
    .bind(id, project.id)
    .first<{ key: string }>();
  if (!v) return c.json({ error: 'not_found' }, 404);

  try {
    const stub = c.env.PROJECT_DO.get(c.env.PROJECT_DO.idFromName(project.id)) as unknown as ProjectDO;
    await stub.deleteVariable(v.key);
  } catch (e) {
    console.error('variable hot-state delete failed', id, e);
  }

  await c.env.DB
    .prepare(`DELETE FROM project_variables WHERE id = ? AND project_id = ?`)
    .bind(id, project.id)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'variable.delete',
      targetType: 'variable',
      targetId: id,
      metadata: { key: v.key },
    })
  );

  return c.body(null, 204);
});

// ---- Project tokens (hardware credentials) --------------------------------

// GET /v1/admin/projects/:proj/tokens
variables.get('/tokens', async (c) => {
  const project = c.get('project');
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, created_at, last_used_at, revoked_at
         FROM project_tokens WHERE project_id = ? ORDER BY created_at DESC`
    )
    .bind(project.id)
    .all<{
      id: string;
      name: string | null;
      created_at: number;
      last_used_at: number | null;
      revoked_at: number | null;
    }>();
  return c.json({ tokens: rows.results });
});

// POST /v1/admin/projects/:proj/tokens  body: { name? }
// Returns { id, name, token } ONCE — token is never stored plaintext.
variables.post('/tokens', async (c) => {
  const body = await c.req.json<{ name?: string | null }>().catch(() => ({} as { name?: string | null }));
  const project = c.get('project');
  const user = c.get('user');
  const id = newId('token');
  const token = newToken();
  const hash = await sha256Hex(token);
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB
    .prepare(
      `INSERT INTO project_tokens (id, project_id, name, hash, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(id, project.id, body.name ?? null, hash, user.id, now)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'token.create',
      targetType: 'project_token',
      targetId: id,
    })
  );

  return c.json({ id, name: body.name ?? null, created_at: now, token }, 201);
});

// POST /v1/admin/projects/:proj/tokens/:id/revoke
variables.post('/tokens/:id/revoke', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const id = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  const res = await c.env.DB
    .prepare(`UPDATE project_tokens SET revoked_at = ? WHERE id = ? AND project_id = ? AND revoked_at IS NULL`)
    .bind(now, id, project.id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'token.revoke',
      targetType: 'project_token',
      targetId: id,
    })
  );

  return c.json({ id, revoked_at: now });
});

export default variables;
