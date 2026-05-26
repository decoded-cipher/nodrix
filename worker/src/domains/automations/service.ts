import type { Env } from '../../env';
import { newId } from '../../platform/lib/ids';
import { recordAudit } from '../../platform/lib/audit';
import { runAutomation as runAutomationEngine } from '../../platform/engine/run';
import type { AutomationContext, AutomationRow as EngineAutomationRow } from '../../platform/engine/types';
import { rescheduleScheduler } from '../../platform/durable-objects/scheduler-do';
import { projectStub } from '../../platform/durable-objects/stubs';
import { safeParse, buildUpdate } from '../../platform/lib/sql';
import { type Actor, ServiceError } from '../../platform/lib/service';
import { assertProjectAccess } from '../projects/service';

const TRIGGER_TYPES = ['variable', 'scene', 'schedule', 'sunset_sunrise', 'event'] as const;
type TriggerType = (typeof TRIGGER_TYPES)[number];

export function isScheduled(t: string | undefined): boolean {
  return t === 'schedule' || t === 'sunset_sunrise';
}

// Tell the Project DO to drop its cached automation list so the next telemetry
// ingest re-reads variable triggers from D1 immediately.
export async function invalidateProjectDO(env: Env, projectId: string): Promise<void> {
  try {
    await projectStub(env, projectId).invalidateAutomations();
  } catch (e) {
    console.error('invalidate automations cache failed', projectId, e);
  }
}

// Re-arming the scheduler is best-effort: a hiccup must not fail the write that
// already committed (matches the routers' fire-and-forget waitUntil).
export async function safeReschedule(env: Env): Promise<void> {
  try {
    await rescheduleScheduler(env);
  } catch (e) {
    console.error('reschedule scheduler failed', e);
  }
}

// Full D1 row = the engine's column projection plus the admin-facing metadata.
type AutomationRow = EngineAutomationRow & {
  description: string | null;
  created_at: number;
  updated_at: number;
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
    actions: safeParse(r.actions),
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_run_at: r.last_run_at,
    last_run_status: r.last_run_status,
    last_error: r.last_error,
  };
}

// Mirrors GET /v1/admin/projects/:proj/automations.
export async function listAutomations(env: Env, projectId: string) {
  const rows = await env.DB
    .prepare(
      `SELECT id, project_id, name, description, enabled, trigger_type,
              trigger_config, actions, created_at, updated_at,
              last_run_at, last_run_status, last_error
         FROM automations WHERE project_id = ? ORDER BY created_at DESC`
    )
    .bind(projectId)
    .all<AutomationRow>();
  return rows.results.map(shape);
}

export async function createAutomation(
  env: Env,
  actor: Actor,
  projectId: string,
  input: {
    name: string;
    description?: string | null;
    trigger_type: string;
    trigger_config?: unknown;
    actions?: unknown[];
    enabled?: boolean;
  }
) {
  await assertProjectAccess(env, actor, projectId);
  const name = (input.name ?? '').trim();
  if (!name) throw new ServiceError('bad_request', 'name is required', 'missing_name');
  if (!TRIGGER_TYPES.includes(input.trigger_type as TriggerType)) {
    throw new ServiceError('bad_request', 'invalid trigger_type', 'invalid_trigger_type');
  }

  const id = newId('automation');
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT INTO automations
         (id, project_id, name, description, enabled, trigger_type,
          trigger_config, actions, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, projectId, name, input.description ?? null,
      input.enabled === false ? 0 : 1, input.trigger_type,
      JSON.stringify(input.trigger_config ?? {}),
      JSON.stringify(Array.isArray(input.actions) ? input.actions : []),
      actor.userId, now, now
    )
    .run();

  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: 'automation.create',
    targetType: 'automation',
    targetId: id,
    metadata: { name, trigger_type: input.trigger_type, source: actor.source },
  });
  await invalidateProjectDO(env, projectId);
  if (isScheduled(input.trigger_type)) await safeReschedule(env);

  const row = await env.DB.prepare(`SELECT * FROM automations WHERE id = ?`).bind(id).first<AutomationRow>();
  return shape(row!);
}

export async function updateAutomation(
  env: Env,
  actor: Actor,
  projectId: string,
  id: string,
  input: {
    name?: string;
    description?: string | null;
    enabled?: boolean;
    trigger_config?: unknown;
    actions?: unknown[];
  }
) {
  await assertProjectAccess(env, actor, projectId);
  const existing = await env.DB
    .prepare(`SELECT id, trigger_type FROM automations WHERE id = ? AND project_id = ?`)
    .bind(id, projectId)
    .first<{ id: string; trigger_type: string }>();
  if (!existing) throw new ServiceError('not_found', 'automation not found');

  const u = buildUpdate({
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined,
    description: 'description' in input ? (input.description ?? null) : undefined,
    enabled: typeof input.enabled === 'boolean' ? (input.enabled ? 1 : 0) : undefined,
    trigger_config: 'trigger_config' in input ? JSON.stringify(input.trigger_config ?? {}) : undefined,
    actions: 'actions' in input ? JSON.stringify(Array.isArray(input.actions) ? input.actions : []) : undefined,
  });
  if (!u) throw new ServiceError('bad_request', 'no fields to update', 'no_fields');

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE automations SET ${u.clause}, updated_at = ? WHERE id = ? AND project_id = ?`)
    .bind(...u.values, now, id, projectId)
    .run();

  const providedCount = Object.values(input).filter((v) => v !== undefined).length;
  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: typeof input.enabled === 'boolean' && providedCount === 1
      ? `automation.${input.enabled ? 'enable' : 'disable'}`
      : 'automation.update',
    targetType: 'automation',
    targetId: id,
    metadata: { source: actor.source },
  });
  await invalidateProjectDO(env, projectId);
  if (isScheduled(existing.trigger_type)) await safeReschedule(env);

  const row = await env.DB.prepare(`SELECT * FROM automations WHERE id = ?`).bind(id).first<AutomationRow>();
  return shape(row!);
}

// Manual run — drives "scene" automations and doubles as a test for any
// automation. Runs synchronously so the caller gets the outcome.
export async function runAutomationNow(env: Env, actor: Actor, projectId: string, id: string) {
  await assertProjectAccess(env, actor, projectId);
  const row = await env.DB
    .prepare(`SELECT * FROM automations WHERE id = ? AND project_id = ?`)
    .bind(id, projectId)
    .first<AutomationRow>();
  if (!row) throw new ServiceError('not_found', 'automation not found');

  const ctx: AutomationContext = {
    source: 'manual',
    projectId,
    ts: Math.floor(Date.now() / 1000),
    depth: 0,
  };
  const result = await runAutomationEngine(env, row, ctx);
  const updated = await env.DB.prepare(`SELECT * FROM automations WHERE id = ?`).bind(id).first<AutomationRow>();
  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: 'automation.run',
    targetType: 'automation',
    targetId: id,
    metadata: { status: result.status, source: actor.source },
  });
  return { result, automation: shape(updated!) };
}
