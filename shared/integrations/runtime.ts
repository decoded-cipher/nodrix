// Outbound integration execution. Webhook / HTTP / Email (Resend) and the chat
// connectors are all fetch-based and run natively on Workers. Kept as a
// standalone function so durable/retried delivery could later be wrapped in a
// Workflow without touching the engine.

import type { IntegrationContext, IntegrationResult, IntegrationRow } from './index';
import { interpolate } from './index';
import { runHttpService } from './http_service/run';
import { runEmail } from './email/run';
import { runTelegram } from './telegram/run';
import { runSlack } from './slack/run';
import { runDiscord } from './discord/run';

export type { IntegrationResult } from './index';

// How an action invokes an integration: which operation and the call-site
// params it supplies — authored on the call_integration action node, not stored
// on the integration instance.
export type IntegrationInvocation = {
  operation?: string;
  params?: Record<string, unknown>;
};

export async function executeIntegration(
  integration: IntegrationRow,
  ctx: IntegrationContext,
  inv?: IntegrationInvocation
): Promise<IntegrationResult> {
  if (integration.enabled !== 1) return { status: 'skipped', detail: 'disabled' };

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(integration.config) as Record<string, unknown>;
  } catch {
    config = {};
  }

  // The trigger context an automation passes through. String params are
  // interpolated against it ({{variable}}, {{value}}, …) before the handler runs.
  const body = buildPayload(ctx);
  const params = resolveParams(inv?.params, body);
  const op = inv?.operation;

  switch (integration.kind) {
    // Body-posting connector: send the whole trigger context, no operations.
    case 'http_service': return runHttpService(config, body);
    // Operation-based connectors: act on the resolved call-site params.
    case 'email': return runEmail(config, params, op);
    case 'telegram': return runTelegram(config, params, op);
    case 'slack': return runSlack(config, params, op);
    case 'discord': return runDiscord(config, params, op);
    default: return { status: 'skipped', detail: `kind '${integration.kind}' not executable yet` };
  }
}

// Interpolate every string param against the trigger context once, centrally,
// so per-kind handlers receive ready-to-use values.
function resolveParams(
  params: Record<string, unknown> | undefined,
  body: Record<string, unknown>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(params ?? {})) {
    out[k] = typeof v === 'string' ? interpolate(v, body) : v;
  }
  return out;
}

function buildPayload(ctx: IntegrationContext): Record<string, unknown> {
  return {
    source: ctx.source,
    project_id: ctx.projectId,
    ts: ctx.ts,
    variable: ctx.variable ?? null,
    value: ctx.value ?? null,
    event: ctx.event ?? null,
    ...(ctx.payload ?? {}),
  };
}
