import type { IntegrationResult } from '../index';
import { interpolate } from '../index';
import { doFetch, hmacHex, str, strRecord } from '../lib';

export async function runHttpService(
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

  // Optional HMAC signing so the receiver can verify the payload came from Nodrix.
  const secret = str(config.secret);
  if (secret && typeof init.body === 'string') {
    headers['x-nodrix-signature'] = await hmacHex(secret, init.body);
  }

  return doFetch(url, init);
}
