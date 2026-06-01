import type { IntegrationResult } from '../index';
import { doFetch, str } from '../lib';

// Telegram Bot API. The bot token is connection config; chat_id and message
// arrive as already-interpolated call-site params.
export async function runTelegram(
  config: Record<string, unknown>,
  params: Record<string, unknown>,
  _operation?: string
): Promise<IntegrationResult> {
  const token = str(config.bot_token);
  if (!token) return { status: 'error', detail: 'missing bot_token' };
  const chatId = str(params.chat_id);
  if (!chatId) return { status: 'error', detail: 'missing chat_id' };

  const text = str(params.message) || 'Nodrix notification';

  return doFetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
}
