import type { IntegrationResult } from '../index';
import { doFetch, str } from '../lib';

// Sends via Resend (https://resend.com). The API key and sender are connection
// config; recipient/subject/body are call-site params (already interpolated).
export async function runEmail(
  config: Record<string, unknown>,
  params: Record<string, unknown>,
  _operation?: string
): Promise<IntegrationResult> {
  const apiKey = str(config.api_key);
  if (!apiKey) return { status: 'error', detail: 'missing api_key' };
  const from = str(config.from);
  if (!from) return { status: 'error', detail: 'missing from' };
  const to = str(params.to);
  if (!to) return { status: 'error', detail: 'missing to' };

  const subject = str(params.subject) || 'Nodrix notification';
  const text = str(params.body) || subject;
  const recipients = to.includes(',') ? to.split(',').map((s) => s.trim()).filter(Boolean) : to;

  return doFetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ from, to: recipients, subject, text }),
  });
}
