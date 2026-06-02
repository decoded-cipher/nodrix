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
import {
  buildLinearGraph, isGraph, graphError, graphColumns, legacyView, hasScheduledTrigger,
  type AutomationGraph,
} from './graph-build';

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
  const graph = r.graph ? safeParse(r.graph) : null;
  // Legacy { trigger_config, actions } view derived from the graph for the API
  // response — those columns are no longer stored.
  const legacy = isGraph(graph) ? legacyView(graph) : { trigger_config: {}, actions: [] };
  return {
    id: r.id,
    project_id: r.project_id,
    name: r.name,
    description: r.description,
    enabled: r.enabled === 1,
    trigger_type: r.trigger_type,
    trigger_config: legacy.trigger_config,
    actions: legacy.actions,
    graph,
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
              graph, created_at, updated_at,
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
    trigger_type?: string;
    trigger_config?: unknown;
    actions?: unknown[];
    graph?: unknown;
    enabled?: boolean;
  }
) {
  await assertProjectAccess(env, actor, projectId);
  const name = (input.name ?? '').trim();
  if (!name) throw new ServiceError('bad_request', 'name is required', 'missing_name');

  const graph = inputToGraph(input);
  const err = graphError(graph);
  if (err) throw new ServiceError('bad_request', err, 'invalid_graph');
  const cols = graphColumns(graph);

  const id = newId('automation');
  const now = Math.floor(Date.now() / 1000);
  const enabled = input.enabled === false ? 0 : 1;
  await env.DB
    .prepare(
      `INSERT INTO automations
         (id, project_id, name, description, enabled, trigger_type,
          trigger_kinds, graph, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id, projectId, name, input.description ?? null,
      enabled, cols.trigger_type, cols.trigger_kinds, cols.graph,
      actor.userId, now, now
    )
    .run();

  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: 'automation.create',
    targetType: 'automation',
    targetId: id,
    metadata: { name, trigger_type: cols.trigger_type, source: actor.source },
  });
  await invalidateProjectDO(env, projectId);
  if (hasScheduledTrigger(graph)) await safeReschedule(env);

  // Shape from known values — no re-read of the row we just wrote.
  return shape({
    id, project_id: projectId, name, description: input.description ?? null,
    enabled, trigger_type: cols.trigger_type, graph: cols.graph,
    created_at: now, updated_at: now,
    last_run_at: null, last_run_status: null, last_error: null,
  });
}

// Canonical graph from create/update input: an explicit graph wins; otherwise
// build the linear trigger → action chain from the legacy fields.
function inputToGraph(input: {
  trigger_type?: string;
  trigger_config?: unknown;
  actions?: unknown[];
  graph?: unknown;
}): AutomationGraph {
  if (isGraph(input.graph)) return input.graph;
  return buildLinearGraph(
    input.trigger_type,
    (input.trigger_config ?? {}) as Record<string, unknown>,
    Array.isArray(input.actions) ? input.actions : []
  );
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
    trigger_type?: string;
    trigger_config?: unknown;
    actions?: unknown[];
    graph?: unknown;
  }
) {
  await assertProjectAccess(env, actor, projectId);
  // Load the full row up front so we can return the post-update shape in-memory.
  const existing = await env.DB
    .prepare(
      `SELECT id, project_id, name, description, enabled, trigger_type,
              graph, created_at, updated_at,
              last_run_at, last_run_status, last_error
         FROM automations WHERE id = ? AND project_id = ?`
    )
    .bind(id, projectId)
    .first<AutomationRow>();
  if (!existing) throw new ServiceError('not_found', 'automation not found');

  // Any trigger/action/graph field rebuilds the canonical graph + derived columns.
  const touchesGraph = 'graph' in input || 'trigger_type' in input
    || 'trigger_config' in input || 'actions' in input;
  let graphCols: ReturnType<typeof graphColumns> | undefined;
  let graph: AutomationGraph | undefined;
  if (touchesGraph) {
    if (isGraph(input.graph)) {
      graph = input.graph;
    } else {
      // Legacy partial update: merge the provided legacy fields onto the current
      // graph's derived view (graph is the source of truth now).
      const cur = existing.graph ? safeParse(existing.graph) : null;
      const base = isGraph(cur) ? legacyView(cur) : { trigger_config: {}, actions: [] };
      graph = buildLinearGraph(
        input.trigger_type ?? existing.trigger_type,
        ('trigger_config' in input ? input.trigger_config : base.trigger_config) as Record<string, unknown>,
        'actions' in input ? (Array.isArray(input.actions) ? input.actions : []) : base.actions
      );
    }
    const err = graphError(graph);
    if (err) throw new ServiceError('bad_request', err, 'invalid_graph');
    graphCols = graphColumns(graph);
  }

  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined;
  const description = 'description' in input ? (input.description ?? null) : undefined;
  const enabled = typeof input.enabled === 'boolean' ? (input.enabled ? 1 : 0) : undefined;
  const u = buildUpdate({ name, description, enabled, ...(graphCols ? graphCols : {}) });
  if (!u) throw new ServiceError('bad_request', 'no fields to update', 'no_fields');

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE automations SET ${u.clause}, updated_at = ? WHERE id = ? AND project_id = ?`)
    .bind(...u.values, now, id, projectId)
    .run();

  const onlyEnabled = typeof input.enabled === 'boolean'
    && Object.values(input).filter((v) => v !== undefined).length === 1;
  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: onlyEnabled ? `automation.${input.enabled ? 'enable' : 'disable'}` : 'automation.update',
    targetType: 'automation',
    targetId: id,
    metadata: { source: actor.source },
  });
  await invalidateProjectDO(env, projectId);
  // Re-arm if the automation had or now has a scheduled trigger.
  if (isScheduled(existing.trigger_type) || (graph && hasScheduledTrigger(graph))) await safeReschedule(env);

  // Shape from the loaded row + the applied patch — no re-read.
  return shape({
    ...existing,
    name: name ?? existing.name,
    description: description !== undefined ? description : existing.description,
    enabled: enabled ?? existing.enabled,
    trigger_type: graphCols ? graphCols.trigger_type : existing.trigger_type,
    graph: graphCols ? graphCols.graph : existing.graph,
    updated_at: now,
  });
}

// Manual run — drives manual-trigger automations and doubles as a test for any
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
