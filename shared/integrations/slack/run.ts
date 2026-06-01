import type { IntegrationResult } from '../index';
import { doFetch, str } from '../lib';

// Posts to a Slack incoming webhook. The webhook URL is connection config; the
// message is a call-site param (already interpolated by the runtime).
export async function runSlack(
  config: Record<string, unknown>,
  params: Record<string, unknown>,
  _operation?: string
): Promise<IntegrationResult> {
  const url = str(config.webhook_url);
  if (!url) return { status: 'error', detail: 'missing webhook_url' };

  const text = str(params.message) || 'Nodrix notification';

  return doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}
