import type { IntegrationResult } from '../index';
import { doFetch, str } from '../lib';

// Twilio Messages API for both SMS and WhatsApp. Credentials and the two
// senders are connection config; recipient/message are interpolated call-site
// params. WhatsApp uses a separate sender and a 'whatsapp:' channel prefix on
// both numbers (added here if omitted).
const wa = (n: string): string => (n.startsWith('whatsapp:') ? n : `whatsapp:${n}`);

export async function runTwilio(
  config: Record<string, unknown>,
  params: Record<string, unknown>,
  operation?: string
): Promise<IntegrationResult> {
  const sid = str(config.account_sid);
  if (!sid) return { status: 'error', detail: 'missing account_sid' };
  const token = str(config.auth_token);
  if (!token) return { status: 'error', detail: 'missing auth_token' };

  const isWhatsApp = operation === 'send_whatsapp';
  const fromKey = isWhatsApp ? 'whatsapp_from' : 'sms_from';
  const from = str(config[fromKey]);
  if (!from) return { status: 'error', detail: `missing ${fromKey}` };
  const to = str(params.to);
  if (!to) return { status: 'error', detail: 'missing to' };

  const body = new URLSearchParams({
    To: isWhatsApp ? wa(to) : to,
    From: isWhatsApp ? wa(from) : from,
    Body: str(params.message) || 'Nodrix notification',
  });

  return doFetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      authorization: `Basic ${btoa(`${sid}:${token}`)}`,
    },
    body: body.toString(),
  });
}
