import type { IntegrationResult } from '../index';
import { interpolate } from '../index';
import { doFetch, str } from '../lib';

// Posts to a Slack incoming webhook. The webhook URL is the credential; the
// message is interpolated against the trigger payload.
export async function runSlack(
  config: Record<string, unknown>,
  body: Record<string, unknown>
): Promise<IntegrationResult> {
  const url = str(config.webhook_url);
  if (!url) return { status: 'error', detail: 'missing webhook_url' };

  const text = interpolate(str(config.message), body) || 'Nodrix notification';

  return doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}
