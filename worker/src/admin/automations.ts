import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess } from '../middleware/require-access';
import { resolveUser } from '../middleware/resolve-user';
import { resolveProject, type ProjectContextVars } from '../middleware/resolve-project';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';

const automations = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

automations.use('*', requireAccess);
automations.use('*', resolveUser);
automations.use('*', resolveProject);

const TRIGGER_TYPES = ['schedule', 'device_state', 'sunset_sunrise', 'event', 'scene'] as const;
type TriggerType = (typeof TRIGGER_TYPES)[number];

type AutomationRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  enabled: number;
  trigger_type: TriggerType;
  trigger_config: string;
  actions: string;
  created_at: number;
  updated_at: number;
  last_run_at: number | null;
  last_run_status: 'ok' | 'error' | 'skipped' | null;
  last_error: string | null;
};

function shape(r: AutomationRow) {
  return {
    id: r.id,
    project_id: r.project_id,
    name: r.name,
    description: r.description,
    enabled: r.enabled === 1,
    trigger_type: r.trigger_type,
    trigger_config: safeParse(r.trigger_config),
    actions: safeParse(r.actions) ?? [],
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_run_at: r.last_run_at,
    last_run_status: r.last_run_status,
    last_error: r.last_error,
  };
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

// GET /v1/admin/projects/:proj/automations
automations.get('/', async (c) => {
  const project = c.get('project');
  const rows = await c.env.DB
    .prepare(
      `SELECT id, project_id, name, description, enabled, trigger_type,
              trigger_config, actions, created_at, updated_at,
              last_run_at, last_run_status, last_error
         FROM automations
        WHERE project_id = ?
        ORDER BY created_at DESC`
    )
    .bind(project.id)
    .all<AutomationRow>();
  return c.json({ automations: rows.results.map(shape) });
});

// POST /v1/admin/projects/:proj/automations
automations.post('/', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const body = await c.req.json<{
    name?: string;
    description?: string | null;
    trigger_type?: string;
    trigger_config?: unknown;
    actions?: unknown[];
    enabled?: boolean;
  }>();

  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'bad_request', reason: 'missing_name' }, 400);
  if (!TRIGGER_TYPES.includes(body.trigger_type as TriggerType)) {
    return c.json({ error: 'bad_request', reason: 'invalid_trigger_type' }, 400);
  }

  const id = newId('automation');
  const now = Math.floor(Date.now() / 1000);
  const enabled = body.enabled === false ? 0 : 1;
  const triggerConfig = JSON.stringify(body.trigger_config ?? {});
  const actions = JSON.stringify(Array.isArray(body.actions) ? body.actions : []);

  await c.env.DB
    .prepare(
      `INSERT INTO automations
         (id, project_id, name, description, enabled, trigger_type,
          trigger_config, actions, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      project.id,
      name,
      body.description ?? null,
      enabled,
      body.trigger_type,
      triggerConfig,
      actions,
      user.id,
      now,
      now
    )
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'automation.create',
      targetType: 'automation',
      targetId: id,
      metadata: { name, trigger_type: body.trigger_type },
    })
  );

  const row = await c.env.DB
    .prepare(`SELECT * FROM automations WHERE id = ?`)
    .bind(id)
    .first<AutomationRow>();
  return c.json(shape(row!), 201);
});

// PATCH /v1/admin/projects/:proj/automations/:id
automations.patch('/:id', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    description?: string | null;
    enabled?: boolean;
    trigger_config?: unknown;
    actions?: unknown[];
  }>();

  const existing = await c.env.DB
    .prepare(`SELECT id FROM automations WHERE id = ? AND project_id = ?`)
    .bind(id, project.id)
    .first<{ id: string }>();
  if (!existing) return c.json({ error: 'not_found' }, 404);

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = ?'); vals.push(body.name.trim());
  }
  if ('description' in body) {
    sets.push('description = ?'); vals.push(body.description ?? null);
  }
  if (typeof body.enabled === 'boolean') {
    sets.push('enabled = ?'); vals.push(body.enabled ? 1 : 0);
  }
  if ('trigger_config' in body) {
    sets.push('trigger_config = ?'); vals.push(JSON.stringify(body.trigger_config ?? {}));
  }
  if ('actions' in body) {
    sets.push('actions = ?'); vals.push(JSON.stringify(Array.isArray(body.actions) ? body.actions : []));
  }
  if (sets.length === 0) return c.json({ error: 'bad_request', reason: 'no_fields' }, 400);

  const now = Math.floor(Date.now() / 1000);
  sets.push('updated_at = ?'); vals.push(now);
  vals.push(id, project.id);

  await c.env.DB
    .prepare(`UPDATE automations SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`)
    .bind(...vals)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: typeof body.enabled === 'boolean' && Object.keys(body).length === 1
        ? `automation.${body.enabled ? 'enable' : 'disable'}`
        : 'automation.update',
      targetType: 'automation',
      targetId: id,
    })
  );

  const row = await c.env.DB
    .prepare(`SELECT * FROM automations WHERE id = ?`)
    .bind(id)
    .first<AutomationRow>();
  return c.json(shape(row!));
});

// DELETE /v1/admin/projects/:proj/automations/:id
automations.delete('/:id', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const id = c.req.param('id');

  const res = await c.env.DB
    .prepare(`DELETE FROM automations WHERE id = ? AND project_id = ?`)
    .bind(id, project.id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'automation.delete',
      targetType: 'automation',
      targetId: id,
    })
  );
  return c.body(null, 204);
});

export default automations;
