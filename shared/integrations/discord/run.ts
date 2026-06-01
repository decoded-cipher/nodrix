import type { IntegrationResult } from '../index';
import { doFetch, str } from '../lib';

// Posts to a Discord channel webhook. Discord requires `content` (the generic
// webhook kind sends a context object, which Discord rejects). The webhook URL
// is connection config; the message is a call-site param (already interpolated).
export async function runDiscord(
  config: Record<string, unknown>,
  params: Record<string, unknown>,
  _operation?: string
): Promise<IntegrationResult> {
  const url = str(config.webhook_url);
  if (!url) return { status: 'error', detail: 'missing webhook_url' };

  const content = str(params.message) || 'Nodrix notification';

  return doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ content }),
  });
}
