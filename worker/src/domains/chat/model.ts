// Resolves which language model the chat uses. With a sealed BYO-token config we
// dynamic-import only the chosen provider (keeps the others out of the hot path);
// without one we fall back to Workers AI (env.AI), which has no extra cost setup
// but weaker tool-calling than a frontier model.

import { createWorkersAI } from 'workers-ai-provider';
import type { LanguageModel } from 'ai';
import type { Env } from '../../env';
import { getAiChatConfig } from '../settings/ai-chat';

// Overridable per provider via the sealed config's `model`.
const DEFAULT_MODEL = {
  anthropic: 'claude-3-5-sonnet-latest',
  openai: 'gpt-4o-mini',
  google: 'gemini-2.0-flash',
} as const;

const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export type ResolvedModel = { model: LanguageModel; source: 'byo' | 'workers-ai' };

export async function resolveModel(env: Env): Promise<ResolvedModel> {
  const cfg = await getAiChatConfig(env);
  if (cfg) {
    const model = cfg.model || DEFAULT_MODEL[cfg.provider];
    switch (cfg.provider) {
      case 'anthropic': {
        const { createAnthropic } = await import('@ai-sdk/anthropic');
        return { model: createAnthropic({ apiKey: cfg.apiKey })(model), source: 'byo' };
      }
      case 'openai': {
        const { createOpenAI } = await import('@ai-sdk/openai');
        return { model: createOpenAI({ apiKey: cfg.apiKey })(model), source: 'byo' };
      }
      case 'google': {
        const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
        return { model: createGoogleGenerativeAI({ apiKey: cfg.apiKey })(model), source: 'byo' };
      }
    }
  }
  const workersai = createWorkersAI({ binding: env.AI });
  return { model: workersai(WORKERS_AI_MODEL), source: 'workers-ai' };
}
