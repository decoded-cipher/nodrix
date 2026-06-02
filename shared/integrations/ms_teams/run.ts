import type { IntegrationResult } from '../index';
import { doFetch, str } from '../lib';

// Posts to a Microsoft Teams incoming webhook. The webhook URL is connection
// config; the message is a call-site param (already interpolated). Sent as a
// MessageCard, which both classic connector and Workflows webhooks accept.
export async function runMsTeams(
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
    body: JSON.stringify({ '@type': 'MessageCard', '@context': 'https://schema.org/extensions', text }),
  });
}
