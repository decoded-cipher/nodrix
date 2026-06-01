import type { IntegrationResult } from '../index';
import { doFetch, hmacHex, str, strRecord } from '../lib';

export async function runWebhook(
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
