import type { IntegrationResult } from '../index';
import { interpolate } from '../index';
import { doFetch, str } from '../lib';

// Sends via Resend (https://resend.com). The API key, sender, and recipient are
// connection config; subject/body are interpolated against the trigger payload.
export async function runEmail(
  config: Record<string, unknown>,
  body: Record<string, unknown>
): Promise<IntegrationResult> {
  const apiKey = str(config.api_key);
  if (!apiKey) return { status: 'error', detail: 'missing api_key' };
  const from = str(config.from);
  if (!from) return { status: 'error', detail: 'missing from' };
  const to = str(config.to);
  if (!to) return { status: 'error', detail: 'missing to' };

  const subject = interpolate(str(config.subject), body) || 'Nodrix notification';
  const text = interpolate(str(config.body), body) || subject;
  const recipients = to.includes(',') ? to.split(',').map((s) => s.trim()).filter(Boolean) : to;

  return doFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to: recipients, subject, text }),
  });
}
