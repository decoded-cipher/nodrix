import type { IntegrationResult } from '../index';
import { doFetch, str } from '../lib';

const SEVERITIES = new Set(['critical', 'error', 'warning', 'info']);

// PagerDuty Events API v2. The routing key is connection config; summary,
// severity, source and an optional dedup key are call-site params (already
// interpolated). event_action is always 'trigger' for now.
export async function runPagerDuty(
  config: Record<string, unknown>,
  params: Record<string, unknown>,
  _operation?: string
): Promise<IntegrationResult> {
  const routingKey = str(config.routing_key);
  if (!routingKey) return { status: 'error', detail: 'missing routing_key' };

  const severity = SEVERITIES.has(str(params.severity)) ? str(params.severity) : 'warning';
  const dedupKey = str(params.dedup_key);

  return doFetch('https://events.pagerduty.com/v2/enqueue', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      routing_key: routingKey,
      event_action: 'trigger',
      ...(dedupKey ? { dedup_key: dedupKey } : {}),
      payload: {
        summary: str(params.summary) || 'Nodrix notification',
        source: str(params.source) || 'nodrix',
        severity,
      },
    }),
  });
}
