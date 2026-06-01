// Outbound integration execution. Webhook / HTTP / Email (Resend) are all
// fetch-based and run natively on Workers. Kept as a standalone function so
// durable/retried delivery could later be wrapped in a Workflow without
// touching the engine.

import type { IntegrationContext, IntegrationResult, IntegrationRow } from './index';
import { runWebhook } from './webhook/run';
import { runHttpService } from './http_service/run';
import { runEmail } from './email/run';
import { runTelegram } from './telegram/run';
import { runSlack } from './slack/run';
import { runDiscord } from './discord/run';

export type { IntegrationResult } from './index';

export async function executeIntegration(
  integration: IntegrationRow,
  ctx: IntegrationContext,
  extra?: Record<string, unknown>
): Promise<IntegrationResult> {
  if (integration.enabled !== 1) return { status: 'skipped', detail: 'disabled' };

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(integration.config) as Record<string, unknown>;
  } catch {
    config = {};
  }

  const body = buildPayload(ctx, extra);

  switch (integration.kind) {
    case 'webhook': return runWebhook(config, body);
    case 'http_service': return runHttpService(config, body);
    case 'email': return runEmail(config, body);
    case 'telegram': return runTelegram(config, body);
    case 'slack': return runSlack(config, body);
    case 'discord': return runDiscord(config, body);
    default: return { status: 'skipped', detail: `kind '${integration.kind}' not executable yet` };
  }
}

function buildPayload(
  ctx: IntegrationContext,
  extra?: Record<string, unknown>
): Record<string, unknown> {
  return {
    source: ctx.source,
    project_id: ctx.projectId,
    ts: ctx.ts,
    variable: ctx.variable ?? null,
    value: ctx.value ?? null,
    event: ctx.event ?? null,
    ...(ctx.payload ?? {}),
    ...(extra ?? {}),
  };
}
