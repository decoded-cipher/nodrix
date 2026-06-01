import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession } from '../../platform/middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../../platform/middleware/resolve-project';
import { recordAudit } from '../../platform/lib/audit';
import { ensureScheduler } from '../../platform/durable-objects/scheduler-do';
import {
  listAutomations,
  createAutomation,
  updateAutomation,
  runAutomationNow,
  isScheduled,
  invalidateProjectDO,
  safeReschedule,
} from './service';
import { actorFromSession, serviceErrorResponse } from '../../platform/lib/service';

const automations = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

automations.use('*', requireSession);
automations.use('*', resolveProject);

// GET /v1/admin/projects/:proj/automations
automations.get('/', async (c) => {
  const project = c.get('project');
  const list = await listAutomations(c.env, project.id);

  // Lazily self-heal the scheduler if this project has scheduled automations.
  if (list.some((a) => isScheduled(a.trigger_type) && a.enabled)) {
    c.executionCtx.waitUntil(ensureScheduler(c.env));
  }

  return c.json({ automations: list });
});

// POST /v1/admin/projects/:proj/automations
automations.post('/', async (c) => {
  const project = c.get('project');
  const body = await c.req.json<{
    name?: string;
    description?: string | null;
    trigger_type?: string;
    trigger_config?: unknown;
    actions?: unknown[];
    graph?: unknown;
    enabled?: boolean;
  }>();
  try {
    const a = await createAutomation(c.env, actorFromSession(c.get('user')), project.id, {
      name: body.name ?? '',
      description: body.description ?? null,
      trigger_type: body.trigger_type,
      trigger_config: body.trigger_config,
      actions: body.actions,
      graph: body.graph,
      enabled: body.enabled,
    });
    return c.json(a, 201);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

// Manual run — drives manual-trigger automations and doubles as a test harness
// for any automation. Runs synchronously so the UI gets the outcome.
automations.post('/:id/run', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  try {
    const out = await runAutomationNow(c.env, actorFromSession(c.get('user')), project.id, id);
    return c.json(out);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

// PATCH /v1/admin/projects/:proj/automations/:id
automations.patch('/:id', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    description?: string | null;
    enabled?: boolean;
    trigger_type?: string;
    trigger_config?: unknown;
    actions?: unknown[];
    graph?: unknown;
  }>();
  try {
    const a = await updateAutomation(c.env, actorFromSession(c.get('user')), project.id, id, {
      name: body.name,
      ...('description' in body ? { description: body.description ?? null } : {}),
      enabled: body.enabled,
      ...('trigger_type' in body ? { trigger_type: body.trigger_type } : {}),
      ...('trigger_config' in body ? { trigger_config: body.trigger_config } : {}),
      ...('actions' in body ? { actions: body.actions } : {}),
      ...('graph' in body ? { graph: body.graph } : {}),
    });
    return c.json(a);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

// DELETE /v1/admin/projects/:proj/automations/:id
automations.delete('/:id', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const id = c.req.param('id');

  const existing = await c.env.DB
    .prepare(`SELECT trigger_type FROM automations WHERE id = ? AND project_id = ?`)
    .bind(id, project.id)
    .first<{ trigger_type: string }>();

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
  c.executionCtx.waitUntil(invalidateProjectDO(c.env, project.id));
  if (isScheduled(existing?.trigger_type)) c.executionCtx.waitUntil(safeReschedule(c.env));
  return c.body(null, 204);
});

export default automations;
