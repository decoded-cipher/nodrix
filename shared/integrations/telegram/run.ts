import type { IntegrationResult } from '../index';
import { interpolate } from '../index';
import { doFetch, str } from '../lib';

// Sends a message via the Telegram Bot API. The bot token and chat id are
// connection config; the message body is interpolated against the trigger payload.
export async function runTelegram(
  config: Record<string, unknown>,
  body: Record<string, unknown>
): Promise<IntegrationResult> {
  const token = str(config.bot_token);
  if (!token) return { status: 'error', detail: 'missing bot_token' };
  const chatId = str(config.chat_id);
  if (!chatId) return { status: 'error', detail: 'missing chat_id' };

  const text = interpolate(str(config.message), body) || 'Nodrix notification';

  return doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
