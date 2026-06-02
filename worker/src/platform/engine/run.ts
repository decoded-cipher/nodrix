// Automation orchestrator. Builds the flow graph, walks it from the trigger node
// running each action via the kind→handler registry, and records the outcome on
// the row + audit log. DAG traversal: each node runs once; a step cap bounds it.
//
// Callable from anywhere: the ProjectDO hot path, the cron scheduled handler, the
// manual-run endpoint, and /v1/events. `set_variable` differs by caller (DO binds
// addControl; the worker routes to the PROJECT_DO stub), so it's injectable via deps.

import { VALID_ACTION_KINDS, VALID_CONDITION_KINDS } from '@nodrix/blocks-shared';
import type { Env } from '../../env';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { projectStub } from '../durable-objects/stubs';
import { runActionNode, type ActionDeps } from './actions';
import { evalCondition } from './conditions';
import { toGraph, entryNode, nodesById, outgoingEdges, countActionNodes, triggerNodes } from './graph';
import type { AutomationContext, AutomationRow, RunResult, RunStatus } from './types';

const MAX_STEPS = 100;
const MAX_DELAY_SECONDS = 86_400;              // 24h — longer waits belong on a schedule trigger
const MAX_PENDING_DELAYS_PER_PROJECT = 100;    // bounds accumulated continuations (cost guard)
const UNIT_SECONDS: Record<string, number> = { seconds: 1, minutes: 60, hours: 3600 };

export type RunDeps = {
  // Enqueue a control write. Defaults to the PROJECT_DO stub path.
  setVariable?: ActionDeps['setVariable'];
  // Re-entry for emit_event. Defaults to dispatchEvent over D1.
  emitEvent?: ActionDeps['emitEvent'];
  // Read a variable's latest value (for condition nodes). Defaults to the DO stub.
  getVariable?: (variable: string) => Promise<unknown>;
  // Persist a delay continuation + arm the scheduler. Defaults to the D1 path.
  scheduleDelay?: (
    automation: AutomationRow,
    nodeId: string,
    ctx: AutomationContext,
    fireAtMs: number
  ) => Promise<void>;
};

export async function runAutomation(
  env: Env,
  automation: AutomationRow,
  ctx: AutomationContext,
  deps: RunDeps = {}
): Promise<RunResult> {
  const graph = toGraph(automation);
  const byId = nodesById(graph);
  // Enter at the trigger that fired (multi-trigger); fall back to the graph entry.
  const start = (ctx.entryNodeId ? byId.get(ctx.entryNodeId) : undefined) ?? entryNode(graph);

  // Trigger cooldown: suppress re-fires within the window, measured from the last
  // real run. Skipped silently (no last_run_at write) so the window isn't reset,
  // never applied to manual runs, and never to a delay resume (it must complete).
  const cooldown = Number((start?.config as { cooldown_seconds?: unknown })?.cooldown_seconds ?? 0);
  if (ctx.source !== 'manual' && ctx.resumeNodeId == null && cooldown > 0 && automation.last_run_at != null
      && ctx.ts - automation.last_run_at < cooldown) {
    return { status: 'skipped', actionsRun: 0 };
  }

  const actionDeps: ActionDeps = {
    setVariable: deps.setVariable ?? defaultSetVariable(env, automation.project_id),
    emitEvent: deps.emitEvent ?? defaultEmitEvent(env),
  };
  const getVariable = deps.getVariable ?? defaultGetVariable(env, automation.project_id);
  const scheduleDelay = deps.scheduleDelay ?? defaultScheduleDelay(env);

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

    // Action nodes execute; condition nodes pick a branch port; trigger nodes are
    // pass-through entrypoints. `delay` suspends the branch on the first pass and
    // passes through when re-entered as a resume.
    let branch: string | null = null;
    if (node.kind === 'delay') {
      if (ctx.resumeNodeId !== id) {
        const secs = delaySeconds(node.config);
        await scheduleDelay(automation, id, ctx, Date.now() + secs * 1000);
        return; // suspend until resumed
      }
    } else if (VALID_ACTION_KINDS.has(node.kind)) {
      await runActionNode(node.kind, { env, automation, ctx, config: node.config, deps: actionDeps });
      actionsRun++;
    } else if (VALID_CONDITION_KINDS.has(node.kind)) {
      branch = (await evalCondition(node.kind, { ctx, config: node.config, deps: { getVariable } })) ? 'true' : 'false';
    }

    for (const e of outgoingEdges(graph, id)) {
      if (branch !== null && (e.port ?? 'out') !== branch) continue;
      await visit(e.to);
    }
  };

  try {
    if (start) await visit(start.id);
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
      `SELECT id, project_id, name, enabled, trigger_type, graph, last_run_at
         FROM automations
        WHERE project_id = ? AND enabled = 1 AND trigger_kinds LIKE '%,event,%'`
    )
    .bind(projectId)
    .all<AutomationRow>();

  let ran = 0;
  for (const a of rows.results) {
    for (const node of triggerNodes(toGraph(a))) {
      if (node.kind !== 'event' || (node.config as { event?: string }).event !== eventName) continue;

      const ctx: AutomationContext = {
        source: 'event',
        projectId,
        ts: Math.floor(Date.now() / 1000),
        event: eventName,
        payload,
        depth,
        entryNodeId: node.id,
      };
      await runAutomation(env, a, ctx, { emitEvent: defaultEmitEvent(env) });
      ran++;
    }
  }
  return ran;
}

// Resolve a delay node's config to whole seconds, clamped to [1, MAX]. Bad or
// missing config falls back to 30s rather than failing the run.
function delaySeconds(config: Record<string, unknown>): number {
  const amount = Number(config.delay_amount);
  const unit = UNIT_SECONDS[String(config.delay_unit)] ?? 1;
  const secs = Number.isFinite(amount) && amount > 0 ? amount * unit : 30;
  return Math.min(Math.max(Math.round(secs), 1), MAX_DELAY_SECONDS);
}

function defaultScheduleDelay(env: Env): NonNullable<RunDeps['scheduleDelay']> {
  return async (automation, nodeId, ctx, fireAtMs) => {
    const pending = await env.DB
      .prepare(`SELECT COUNT(*) AS n FROM automation_delays WHERE project_id = ?`)
      .bind(automation.project_id)
      .first<{ n: number }>();
    if ((pending?.n ?? 0) >= MAX_PENDING_DELAYS_PER_PROJECT) {
      throw new Error('pending delay limit reached');
    }
    await env.DB
      .prepare(
        `INSERT INTO automation_delays (id, automation_id, project_id, resume_node_id, ctx, fire_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(newId('delay'), automation.id, automation.project_id, nodeId, JSON.stringify(ctx), fireAtMs, Math.floor(Date.now() / 1000))
      .run();
    // Lazy import: keeps the DO module (and `cloudflare:workers`) out of the
    // engine's static graph and avoids a scheduler→schedule→run cycle.
    const { armSchedulerFor } = await import('../durable-objects/scheduler-do');
    await armSchedulerFor(env, fireAtMs); // O(1) — only pulls the alarm earlier if needed
  };
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

function defaultGetVariable(env: Env, projectId: string): (variable: string) => Promise<unknown> {
  return async (variable) => {
    const rows = await projectStub(env, projectId).getLatestState();
    return rows.find((r) => r.variable === variable)?.value;
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
