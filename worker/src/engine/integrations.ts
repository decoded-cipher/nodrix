// Outbound integration execution. Webhook / Slack / HTTP are all fetch-based and
// run natively on Workers. email / mqtt / code_block are not executable yet and
// return 'skipped'. Kept as a standalone function so durable/retried delivery
// could later be wrapped in a Workflow without touching the engine.

import type { Env } from '../env';
import type { AutomationContext, IntegrationRow } from './types';

const TIMEOUT_MS = 10_000;

export type IntegrationResult = { status: 'ok' | 'error' | 'skipped'; detail?: string };

export async function executeIntegration(
  env: Env,
  integration: IntegrationRow,
  ctx: AutomationContext,
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
    case 'slack': return runSlack(config, ctx, body);
    case 'http_service': return runHttpService(config, body);
    default: return { status: 'skipped', detail: `kind '${integration.kind}' not executable yet` };
  }
}

// Stamps the outcome of a delivery onto the integration row so the UI can show
// "last delivered / last error" per connection. Best-effort: failures here must
// not break the run, so callers swallow errors.
export async function recordIntegrationRun(
  env: Env,
  id: string,
  result: IntegrationResult
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE integrations SET last_run_at = ?, last_run_status = ?, last_error = ? WHERE id = ?`)
    .bind(now, result.status, result.status === 'error' ? (result.detail ?? 'error') : null, id)
    .run();
}

function buildPayload(
  ctx: AutomationContext,
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

async function runWebhook(
  config: Record<string, unknown>,
  body: Record<string, unknown>
): Promise<IntegrationResult> {
  const url = str(config.url);
  if (!url) return { status: 'error', detail: 'missing url' };

  const json = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json', ...strRecord(config.headers) };
  const secret = str(config.secret);
  if (secret) headers['x-nodrix-signature'] = await hmacHex(secret, json);

  return doFetch(url, { method: 'POST', headers, body: json });
}

async function runSlack(
  config: Record<string, unknown>,
  ctx: AutomationContext,
  body: Record<string, unknown>
): Promise<IntegrationResult> {
  const url = str(config.webhook_url);
  if (!url) return { status: 'error', detail: 'missing webhook_url' };

  const template = str(config.template);
  const text = template ? interpolate(template, body) : defaultText(ctx);
  return doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

async function runHttpService(
  config: Record<string, unknown>,
  body: Record<string, unknown>
): Promise<IntegrationResult> {
  const url = str(config.url);
  if (!url) return { status: 'error', detail: 'missing url' };

  const method = (str(config.method) || 'POST').toUpperCase();
  const headers: Record<string, string> = strRecord(config.headers);
  const init: RequestInit = { method, headers };

  if (method !== 'GET' && method !== 'HEAD') {
    const template = str(config.body_template);
    init.body = template ? interpolate(template, body) : JSON.stringify(body);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) {
      headers['content-type'] = 'application/json';
    }
  }
  return doFetch(url, init);
}

async function doFetch(url: string, init: RequestInit): Promise<IntegrationResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? { status: 'ok', detail: String(res.status) } : { status: 'error', detail: `http ${res.status}` };
  } catch (e) {
    return { status: 'error', detail: (e as Error).message };
  }
}

function defaultText(ctx: AutomationContext): string {
  if (ctx.variable !== undefined) {
    return `nodrix: ${ctx.variable} = ${formatValue(ctx.value)} (${ctx.source})`;
  }
  if (ctx.event) return `nodrix: event "${ctx.event}" (${ctx.source})`;
  return `nodrix: automation ran (${ctx.source})`;
}

function formatValue(v: unknown): string {
  return v === undefined || v === null ? 'null' : String(v);
}

function interpolate(tpl: string, vars: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? '' : String(v);
  });
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function strRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}
