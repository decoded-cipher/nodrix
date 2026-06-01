// Automation orchestrator. Builds the automation's flow graph, walks it from the
// trigger node running each action via the kind→handler registry, and records the
// outcome on the row + audit log. DAG traversal: each node runs once, condition
// ports gate which edges are followed, and a step cap bounds runaway graphs.
//
// Callable from anywhere: the ProjectDO hot path, the cron scheduled handler, the
// manual-run endpoint, and /v1/events. `set_variable` differs by caller (DO binds
// addControl; the worker routes to the PROJECT_DO stub), so it's injectable via deps.

import { VALID_ACTION_KINDS } from '@nodrix/blocks-shared';
import type { Env } from '../../env';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { projectStub } from '../durable-objects/stubs';
import { runActionNode, type ActionDeps } from './actions';
import { toGraph, entryNode, nodesById, outgoingEdges, countActionNodes } from './graph';
import type { AutomationContext, AutomationRow, RunResult, RunStatus } from './types';

const MAX_STEPS = 100;

export type RunDeps = {
  // Enqueue a control write. Defaults to the PROJECT_DO stub path.
  setVariable?: ActionDeps['setVariable'];
  // Re-entry for emit_event. Defaults to dispatchEvent over D1.
  emitEvent?: ActionDeps['emitEvent'];
};

export async function runAutomation(
  env: Env,
  automation: AutomationRow,
  ctx: AutomationContext,
  deps: RunDeps = {}
): Promise<RunResult> {
  const graph = toGraph(automation);
  const entry = entryNode(graph);

  // Trigger cooldown: suppress re-fires within the window, measured from the last
  // real run. Skipped silently (no last_run_at write) so the window isn't reset,
  // and never applied to manual runs.
  const cooldown = Number((entry?.config as { cooldown_seconds?: unknown })?.cooldown_seconds ?? 0);
  if (ctx.source !== 'manual' && cooldown > 0 && automation.last_run_at != null
      && ctx.ts - automation.last_run_at < cooldown) {
    return { status: 'skipped', actionsRun: 0 };
  }

  const actionDeps: ActionDeps = {
    setVariable: deps.setVariable ?? defaultSetVariable(env, automation.project_id),
    emitEvent: deps.emitEvent ?? defaultEmitEvent(env),
  };
  const byId = nodesById(graph);

  let actionsRun = 0;
  let status: RunStatus = countActionNodes(graph) === 0 ? 'skipped' : 'ok';
  let error: string | undefined;

  const visited = new Set<string>();
  let steps = 0;

  const visit = async (id: string): Promise<void> => {
    if (visited.has(id)) return;
    visited.add(id);
    if (++steps > MAX_STEPS) throw new Error('graph step limit exceeded');

    const node = byId.get(id);
    if (!node) return;

    // Action nodes execute; trigger nodes are pass-through entrypoints. Condition
    // nodes will additionally gate which output ports are followed.
    if (VALID_ACTION_KINDS.has(node.kind)) {
      await runActionNode(node.kind, { env, automation, ctx, config: node.config, deps: actionDeps });
      actionsRun++;
    }

    for (const e of outgoingEdges(graph, id)) {
      await visit(e.to);
    }
  };

  try {
    if (entry) await visit(entry.id);
  } catch (e) {
    status = 'error';
    error = (e as Error).message;
  }

  await recordRun(env, automation.id, status, error);
  await recordAudit(env, {
    projectId: automation.project_id,
    userId: null,
    action: 'automation.run',
    targetType: 'automation',
    targetId: automation.id,
    metadata: { source: ctx.source, status, actions_run: actionsRun, ...(error ? { error } : {}) },
  });

  return { status, error, actionsRun };
}

// Loads enabled `event` automations matching `eventName` and runs each. Returns
// how many ran. Used by POST /v1/events and by emit_event chaining.
export async function dispatchEvent(
  env: Env,
  projectId: string,
  eventName: string,
  payload?: Record<string, unknown>,
  depth = 0
): Promise<number> {
  const rows = await env.DB
    .prepare(
      `SELECT id, project_id, name, enabled, trigger_type, trigger_config, actions, last_run_at
         FROM automations
        WHERE project_id = ? AND enabled = 1 AND trigger_type = 'event'`
    )
    .bind(projectId)
    .all<AutomationRow>();

  let ran = 0;
  for (const a of rows.results) {
    let cfg: { event?: string };
    try { cfg = JSON.parse(a.trigger_config); } catch { cfg = {}; }
    if (cfg.event !== eventName) continue;

    const ctx: AutomationContext = {
      source: 'event',
      projectId,
      ts: Math.floor(Date.now() / 1000),
      event: eventName,
      payload,
      depth,
    };
    await runAutomation(env, a, ctx, { emitEvent: defaultEmitEvent(env) });
    ran++;
  }
  return ran;
}

function defaultSetVariable(env: Env, projectId: string): ActionDeps['setVariable'] {
  return async (variable, value) => {
    await projectStub(env, projectId).addControl(newId('control'), variable, value);
  };
}

function defaultEmitEvent(env: Env): ActionDeps['emitEvent'] {
  return async (event, payload, ctx) => {
    await dispatchEvent(env, ctx.projectId, event, payload, ctx.depth);
  };
}

async function recordRun(
  env: Env,
  id: string,
  status: RunStatus,
  error: string | undefined
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE automations SET last_run_at = ?, last_run_status = ?, last_error = ? WHERE id = ?`)
    .bind(now, status, error ?? null, id)
    .run();
}
