import type { Env } from '../env';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { runAutomation as runAutomationEngine } from '../engine/run';
import type { AutomationContext } from '../engine/types';
import { rescheduleScheduler } from '../do/scheduler-do';
import type { Actor } from './context';
import { ServiceError } from './errors';
import { assertProjectAccess } from './projects';

const TRIGGER_TYPES = ['variable', 'scene', 'schedule', 'sunset_sunrise', 'event'] as const;
type TriggerType = (typeof TRIGGER_TYPES)[number];

function isScheduled(t: string | undefined): boolean {
  return t === 'schedule' || t === 'sunset_sunrise';
}

// Tell the Project DO to drop its cached automation list so the next telemetry
// ingest re-reads variable triggers from D1 immediately.
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

// Re-arming the scheduler is best-effort: a hiccup must not fail the write that
// already committed (matches the routers' fire-and-forget waitUntil).
async function safeReschedule(env: Env): Promise<void> {
  try {
    await rescheduleScheduler(env);
  } catch (e) {
    console.error('reschedule scheduler failed', e);
  }
}

type AutomationRow = {
  id: string;
  project_id: string;
  name: string;
  description: string | null;
  enabled: number;
  trigger_type: string;
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
    actions: safeParse(r.actions),
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

// ---- writes (Phase 3) ------------------------------------------------------

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

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof input.name === 'string' && input.name.trim()) { sets.push('name = ?'); vals.push(input.name.trim()); }
  if ('description' in input) { sets.push('description = ?'); vals.push(input.description ?? null); }
  if (typeof input.enabled === 'boolean') { sets.push('enabled = ?'); vals.push(input.enabled ? 1 : 0); }
  if ('trigger_config' in input) { sets.push('trigger_config = ?'); vals.push(JSON.stringify(input.trigger_config ?? {})); }
  if ('actions' in input) { sets.push('actions = ?'); vals.push(JSON.stringify(Array.isArray(input.actions) ? input.actions : [])); }
  if (sets.length === 0) throw new ServiceError('bad_request', 'no fields to update', 'no_fields');

  const now = Math.floor(Date.now() / 1000);
  sets.push('updated_at = ?'); vals.push(now);
  vals.push(id, projectId);
  await env.DB.prepare(`UPDATE automations SET ${sets.join(', ')} WHERE id = ? AND project_id = ?`).bind(...vals).run();

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
  return { result, automation: shape(updated!) };
}
