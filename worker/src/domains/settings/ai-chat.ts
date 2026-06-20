// AI chat assistant config, backed by deployment_settings (KV-cached). Two keys:
//
//   ai_chat_enabled  — master switch. When absent, the chat endpoints return 404
//                      so a disabled assistant looks absent, not merely forbidden
//                      (mirrors the MCP flag).
//   ai_chat_config   — sealed JSON { provider, apiKey, model? } for the BYO-token
//                      path. Absent → the chat falls back to Workers AI (env.AI).
//
// The token is sealed at rest with the same AES-GCM scheme as integration
// secrets, under its own HKDF info so the stores can't be cross-decrypted. It is
// never returned to the client (settings expose provider + last-4 only).

import type { Env } from '../../env';
import { getSetting, setSetting } from '../../platform/lib/deployment-settings';
import { encryptSecret, decryptSecret } from '../../platform/lib/crypto';
import { getOrCreateSigningSecret } from '../../platform/lib/auth-secret';

export const AI_CHAT_ENABLED_KEY = 'ai_chat_enabled';
export const AI_CHAT_CONFIG_KEY = 'ai_chat_config';

const ENC_INFO = 'ai-chat-config';

export const AI_CHAT_PROVIDERS = ['anthropic', 'openai', 'google'] as const;
export type AiChatProvider = (typeof AI_CHAT_PROVIDERS)[number];
export type AiChatConfig = { provider: AiChatProvider; apiKey: string; model?: string };

export async function aiChatEnabled(env: Env): Promise<boolean> {
  return (await getSetting(env, AI_CHAT_ENABLED_KEY)) === '1';
}

export async function setAiChatEnabled(env: Env, enabled: boolean): Promise<void> {
  await setSetting(env, AI_CHAT_ENABLED_KEY, enabled ? '1' : null);
}

export async function getAiChatConfig(env: Env): Promise<AiChatConfig | null> {
  const stored = await getSetting(env, AI_CHAT_CONFIG_KEY);
  if (!stored) return null;
  try {
    const secret = await getOrCreateSigningSecret(env);
    const json = stored.startsWith('v1:') ? await decryptSecret(secret, stored, ENC_INFO) : stored;
    const cfg = JSON.parse(json) as AiChatConfig;
    return cfg.apiKey && AI_CHAT_PROVIDERS.includes(cfg.provider) ? cfg : null;
  } catch {
    return null;
  }
}

export async function setAiChatConfig(env: Env, cfg: AiChatConfig | null): Promise<void> {
  if (!cfg) {
    await setSetting(env, AI_CHAT_CONFIG_KEY, null);
    return;
  }
  const secret = await getOrCreateSigningSecret(env);
  await setSetting(env, AI_CHAT_CONFIG_KEY, await encryptSecret(secret, JSON.stringify(cfg), ENC_INFO));
}

// Public-safe view of the config — never includes the raw token.
export async function aiChatStatus(env: Env): Promise<{
  enabled: boolean;
  provider: AiChatProvider | null;
  model: string | null;
  has_token: boolean;
  token_last4: string | null;
}> {
  const [enabled, cfg] = await Promise.all([aiChatEnabled(env), getAiChatConfig(env)]);
  return {
    enabled,
    provider: cfg?.provider ?? null,
    model: cfg?.model ?? null,
    has_token: !!cfg,
    token_last4: cfg ? cfg.apiKey.slice(-4) : null,
  };
}
