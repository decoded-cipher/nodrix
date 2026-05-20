// Automation orchestrator. Runs an automation's ordered action list, records the
// outcome on the row + audit log, and supports event chaining with a depth guard.
//
// Callable from anywhere: the ProjectDO hot path, the cron scheduled handler, the
// manual-run endpoint, and the /v1/events endpoint. `set_variable` differs by
// caller (DO binds addControl; the worker routes to the PROJECT_DO stub), so it's
// injectable via deps.

import type { Env } from '../env';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { executeIntegration } from './integrations';
import type { Action, AutomationContext, AutomationRow, IntegrationRow, RunResult } from './types';

const MAX_DEPTH = 5;

export type RunDeps = {
  // Enqueue a control write. Defaults to the PROJECT_DO stub path.
  setVariable?: (variable: string, value: unknown) => Promise<void>;
  // Re-entry for emit_event. Defaults to dispatchEvent over D1.
  emitEvent?: (event: string, payload: Record<string, unknown> | undefined, ctx: AutomationContext) => Promise<void>;
};

export async function runAutomation(
  env: Env,
  automation: AutomationRow,
  ctx: AutomationContext,
  deps: RunDeps = {}
): Promise<RunResult> {
  const actions = parseActions(automation.actions);
  const setVariable = deps.setVariable ?? defaultSetVariable(env, automation.project_id);
  const emitEvent = deps.emitEvent ?? defaultEmitEvent(env);

  let actionsRun = 0;
  let status: RunResult['status'] = actions.length === 0 ? 'skipped' : 'ok';
  let error: string | undefined;

  try {
    for (const action of actions) {
      await runAction(env, automation, ctx, action, setVariable, emitEvent);
      actionsRun++;
    }
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

async function runAction(
  env: Env,
  automation: AutomationRow,
  ctx: AutomationContext,
  action: Action,
  setVariable: NonNullable<RunDeps['setVariable']>,
  emitEvent: NonNullable<RunDeps['emitEvent']>
): Promise<void> {
  switch (action.type) {
    case 'set_variable':
      await setVariable(action.variable, action.value);
      return;

    case 'call_integration': {
      const integration = await loadIntegration(env, automation.project_id, action.integration_id);
      if (!integration) throw new Error(`integration ${action.integration_id} not found`);
      const res = await executeIntegration(env, integration, ctx, action.payload);
      if (res.status === 'error') throw new Error(`integration "${integration.name}": ${res.detail}`);
      return;
    }

    case 'emit_event': {
      if (ctx.depth >= MAX_DEPTH) throw new Error('max event depth exceeded');
      await emitEvent(action.event, action.payload, { ...ctx, depth: ctx.depth + 1 });
      return;
    }
  }
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

function defaultSetVariable(env: Env, projectId: string) {
  return async (variable: string, value: unknown): Promise<void> => {
    const stub = env.PROJECT_DO.get(env.PROJECT_DO.idFromName(projectId)) as unknown as {
      addControl(id: string, variable: string, value: unknown): Promise<void>;
    };
    await stub.addControl(newId('control'), variable, value);
  };
}

function defaultEmitEvent(env: Env) {
  return async (
    event: string,
    payload: Record<string, unknown> | undefined,
    ctx: AutomationContext
  ): Promise<void> => {
    await dispatchEvent(env, ctx.projectId, event, payload, ctx.depth);
  };
}

async function loadIntegration(
  env: Env,
  projectId: string,
  id: string
): Promise<IntegrationRow | null> {
  return env.DB
    .prepare(
      `SELECT id, project_id, name, kind, config, enabled
         FROM integrations
        WHERE id = ? AND project_id = ? AND archived_at IS NULL`
    )
    .bind(id, projectId)
    .first<IntegrationRow>();
}

async function recordRun(
  env: Env,
  id: string,
  status: RunResult['status'],
  error: string | undefined
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE automations SET last_run_at = ?, last_run_status = ?, last_error = ? WHERE id = ?`)
    .bind(now, status, error ?? null, id)
    .run();
}

function parseActions(raw: string): Action[] {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isAction);
}

function isAction(a: unknown): a is Action {
  if (!a || typeof a !== 'object') return false;
  const t = (a as { type?: unknown }).type;
  return t === 'set_variable' || t === 'call_integration' || t === 'emit_event';
}
