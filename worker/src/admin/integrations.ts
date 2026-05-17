import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession } from '../middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../middleware/resolve-project';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';

const integrations = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

integrations.use('*', requireSession);
integrations.use('*', resolveProject);

const KINDS = ['webhook', 'code_block', 'slack', 'email', 'mqtt', 'http_service'] as const;
type Kind = (typeof KINDS)[number];

type IntegrationRow = {
  id: string;
  project_id: string;
  name: string;
  kind: Kind;
  config: string;
  enabled: number;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
};

function shape(r: IntegrationRow) {
  return {
    id: r.id,
    project_id: r.project_id,
    name: r.name,
    kind: r.kind,
    config: safeParse(r.config),
    enabled: r.enabled === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
    archived_at: r.archived_at,
  };
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// GET /v1/admin/projects/:proj/integrations
integrations.get('/', async (c) => {
  const project = c.get('project');
  const rows = await c.env.DB
    .prepare(
      `SELECT id, project_id, name, kind, config, enabled,
              created_at, updated_at, archived_at
         FROM integrations
        WHERE project_id = ? AND archived_at IS NULL
        ORDER BY created_at DESC`
    )
    .bind(project.id)
    .all<IntegrationRow>();
  return c.json({ integrations: rows.results.map(shape) });
});

// POST /v1/admin/projects/:proj/integrations
integrations.post('/', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const body = await c.req.json<{
    name?: string;
    kind?: string;
    config?: unknown;
    enabled?: boolean;
  }>();

  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'bad_request', reason: 'missing_name' }, 400);
  if (!KINDS.includes(body.kind as Kind)) {
    return c.json({ error: 'bad_request', reason: 'invalid_kind' }, 400);
  }

  const id = newId('integration');
  const now = Math.floor(Date.now() / 1000);
  const enabled = body.enabled === false ? 0 : 1;

  await c.env.DB
    .prepare(
      `INSERT INTO integrations
         (id, project_id, name, kind, config, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      project.id,
      name,
      body.kind,
      JSON.stringify(body.config ?? {}),
      enabled,
      user.id,
      now,
      now
    )
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'integration.create',
      targetType: 'integration',
      targetId: id,
      metadata: { name, kind: body.kind },
    })
  );

  const row = await c.env.DB
    .prepare(`SELECT * FROM integrations WHERE id = ?`)
    .bind(id)
    .first<IntegrationRow>();
  return c.json(shape(row!), 201);
});

// PATCH /v1/admin/projects/:proj/integrations/:id
integrations.patch('/:id', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    config?: unknown;
    enabled?: boolean;
  }>();

  const existing = await c.env.DB
    .prepare(`SELECT id FROM integrations WHERE id = ? AND project_id = ?`)
    .bind(id, project.id)
    .first<{ id: string }>();
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = ?'); vals.push(body.name.trim());
  }
  if ('config' in body) {
    sets.push('config = ?'); vals.push(JSON.stringify(body.config ?? {}));
  }
  if (typeof body.enabled === 'boolean') {
    sets.push('enabled = ?'); vals.push(body.enabled ? 1 : 0);
  }
  if (sets.length === 0) return c.json({ error: 'bad_request', reason: 'no_fields' }, 400);

  const now = Math.floor(Date.now() / 1000);
  sets.push('updated_at = ?'); vals.push(now);
  vals.push(id, project.id);

  await c.env.DB
    .prepare(`UPDATE integrations SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`)
    .bind(...vals)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: typeof body.enabled === 'boolean' && Object.keys(body).length === 1
        ? `integration.${body.enabled ? 'enable' : 'disable'}`
        : 'integration.update',
      targetType: 'integration',
      targetId: id,
    })
  );

  const row = await c.env.DB
    .prepare(`SELECT * FROM integrations WHERE id = ?`)
    .bind(id)
    .first<IntegrationRow>();
  return c.json(shape(row!));
});

// DELETE /v1/admin/projects/:proj/integrations/:id  (soft delete via archived_at)
integrations.delete('/:id', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const id = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  const res = await c.env.DB
    .prepare(
      `UPDATE integrations SET archived_at = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND archived_at IS NULL`
    )
    .bind(now, now, id, project.id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'integration.delete',
      targetType: 'integration',
      targetId: id,
    })
  );
  return c.body(null, 204);
});

export default integrations;
