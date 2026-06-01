import type { IntegrationResult } from '../index';
import { doFetch, str } from '../lib';

// Brand orange (Tailwind orange-600), as the decimal int Discord wants.
const NODRIX_ORANGE = 0xea580c;

// Posts to a Discord channel webhook: `send_message` as plain content,
// `send_embed` as a branded rich embed. Params arrive already interpolated.
export async function runDiscord(
  config: Record<string, unknown>,
  params: Record<string, unknown>,
  operation?: string
): Promise<IntegrationResult> {
  const url = str(config.webhook_url);
  if (!url) return { status: 'error', detail: 'missing webhook_url' };

  let payload: Record<string, unknown>;
  if (operation === 'send_embed') {
    const title = str(params.title);
    const description = str(params.description);
    if (!title && !description) return { status: 'error', detail: 'embed needs a title or description' };
    const embed: Record<string, unknown> = { color: NODRIX_ORANGE };
    if (title) embed.title = title;
    if (description) embed.description = description;
    payload = { embeds: [embed] };
  } else {
    payload = { content: str(params.message) || 'Nodrix notification' };
  }

  return doFetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
