import type { IntegrationResult } from '../index';
import { interpolate } from '../index';
import { doFetch, str } from '../lib';

// Posts to a Discord channel webhook. Discord requires `content` (the generic
// webhook kind sends a context object, which Discord rejects). The webhook URL
// is the credential; the message is interpolated against the trigger payload.
export async function runDiscord(
  config: Record<string, unknown>,
  body: Record<string, unknown>
): Promise<IntegrationResult> {
  const url = str(config.webhook_url);
  if (!url) return { status: 'error', detail: 'missing webhook_url' };

  const content = interpolate(str(config.message), body) || 'Nodrix notification';

  return doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}
