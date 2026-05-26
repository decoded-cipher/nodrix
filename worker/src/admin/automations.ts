import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession } from '../middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../middleware/resolve-project';
import { recordAudit } from '../lib/audit';
import { rescheduleScheduler, ensureScheduler } from '../do/scheduler-do';
import { createAutomation, updateAutomation, runAutomationNow } from '../services/automations';
import { actorFromSession, serviceErrorResponse } from '../lib/service-http';

const automations = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

// schedule + sunset/sunrise automations are driven by the SchedulerDO alarm;
// changes to them re-arm the alarm to the new next fire time.
function isScheduled(triggerType: string | undefined): boolean {
  return triggerType === 'schedule' || triggerType === 'sunset_sunrise';
}

automations.use('*', requireSession);
automations.use('*', resolveProject);

const TRIGGER_TYPES = ['variable', 'scene', 'schedule', 'sunset_sunrise', 'event'] as const;
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

// Best-effort: tell the Project DO to drop its cached automation list so the
// next telemetry ingest re-reads variable triggers from D1 immediately.
async function invalidateProjectDO(env: Env, projectId: string): Promise<void> {
  try {
    const stub = env.PROJECT_DO.get(env.PROJECT_DO.idFromName(projectId)) as unknown as {
      invalidateAutomations(): Promise<void>;
    };
    await stub.invalidateAutomations();
  } catch (e) {
    console.error('invalidate automations cache failed', projectId, e);
  }
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

  // Lazily self-heal the scheduler if this project has scheduled automations.
  if (rows.results.some((r) => isScheduled(r.trigger_type) && r.enabled === 1)) {
    c.executionCtx.waitUntil(ensureScheduler(c.env));
  }

  return c.json({ automations: rows.results.map(shape) });
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
    enabled?: boolean;
  }>();
  try {
    const a = await createAutomation(c.env, actorFromSession(c.get('user')), project.id, {
      name: body.name ?? '',
      description: body.description ?? null,
      trigger_type: body.trigger_type ?? '',
      trigger_config: body.trigger_config,
      actions: body.actions,
      enabled: body.enabled,
    });
    return c.json(a, 201);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

// POST /v1/admin/projects/:proj/automations/:id/run
// Manual run — drives "scene" automations and doubles as a test harness for any
// automation. Runs synchronously so the UI gets the outcome.
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
    trigger_config?: unknown;
    actions?: unknown[];
  }>();
  try {
    const a = await updateAutomation(c.env, actorFromSession(c.get('user')), project.id, id, {
      name: body.name,
      ...('description' in body ? { description: body.description ?? null } : {}),
      enabled: body.enabled,
      ...('trigger_config' in body ? { trigger_config: body.trigger_config } : {}),
      ...('actions' in body ? { actions: body.actions } : {}),
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
  if (isScheduled(existing?.trigger_type)) c.executionCtx.waitUntil(rescheduleScheduler(c.env));
  return c.body(null, 204);
});

export default automations;
