// Action node handlers, keyed by kind. Adding an action = register a handler here
// and add its manifest to @nodrix/blocks-shared.

import type { Env } from '../../env';
import { executeIntegration, recordIntegrationRun } from './integrations';
import { openIntegrationConfig } from '../lib/integration-secrets';
import type { AutomationContext, AutomationRow, IntegrationRow } from './types';

export const MAX_DEPTH = 5;

export type ActionDeps = {
  setVariable: (variable: string, value: unknown) => Promise<void>;
  emitEvent: (
    event: string,
    payload: Record<string, unknown> | undefined,
    ctx: AutomationContext
  ) => Promise<void>;
};

type HandlerArgs = {
  env: Env;
  automation: AutomationRow;
  ctx: AutomationContext;
  config: Record<string, unknown>;
  deps: ActionDeps;
};

type ActionHandler = (a: HandlerArgs) => Promise<void>;

const HANDLERS: Record<string, ActionHandler> = {
  set_variable: async ({ config, deps }) => {
    await deps.setVariable(String(config.variable), config.value);
  },

  call_integration: async ({ env, automation, ctx, config }) => {
    const integration = await loadIntegration(env, automation.project_id, String(config.integration_id));
    if (!integration) throw new Error(`integration ${config.integration_id} not found`);
    const res = await executeIntegration(integration, ctx, {
      operation: config.operation as string | undefined,
      params: config.params as Record<string, unknown> | undefined,
    });
    await recordIntegrationRun(env, integration.id, res).catch(() => {});
    if (res.status === 'error') throw new Error(`integration "${integration.name}": ${res.detail}`);
  },

  emit_event: async ({ ctx, config, deps }) => {
    if (ctx.depth >= MAX_DEPTH) throw new Error('max event depth exceeded');
    await deps.emitEvent(String(config.event), config.payload as Record<string, unknown> | undefined, {
      ...ctx,
      depth: ctx.depth + 1,
    });
  },
};

export async function runActionNode(kind: string, args: HandlerArgs): Promise<void> {
  const handler = HANDLERS[kind];
  if (!handler) throw new Error(`no handler for action '${kind}'`);
  await handler(args);
}

async function loadIntegration(env: Env, projectId: string, id: string): Promise<IntegrationRow | null> {
  const row = await env.DB
    .prepare(
      `SELECT id, project_id, name, kind, config, enabled
         FROM integrations
        WHERE id = ? AND project_id = ? AND archived_at IS NULL`
    )
    .bind(id, projectId)
    .first<IntegrationRow>();
  if (!row) return null;
  // Decrypt config at the engine boundary so the shared runtime keeps seeing
  // plaintext JSON (it has no access to the signing secret).
  row.config = await openIntegrationConfig(env, row.config);
  return row;
}
