import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession, type UserContextVars } from '../../platform/middleware/require-session';
import { getSetting, setSetting } from '../../platform/lib/deployment-settings';
import { AUDIT_ENABLED_KEY, recordAudit } from '../../platform/lib/audit';
import { MCP_ENABLED_KEY, MCP_WRITE_ENABLED_KEY } from '../../mcp/flags';
import {
  AI_CHAT_PROVIDERS,
  type AiChatProvider,
  aiChatStatus,
  setAiChatEnabled,
  setAiChatConfig,
} from './ai-chat';

// Deployment-wide settings — owner only. The audit-log toggle and the MCP
// server switches.

const settings = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

settings.use('*', requireSession);
settings.use('*', async (c, next) => {
  if (c.get('user').role !== 'owner') return c.json({ error: 'forbidden', reason: 'owner_only' }, 403);
  await next();
});

// GET /v1/admin/settings
settings.get('/', async (c) => {
  const [auditEnabled, mcpEnabled, mcpWriteEnabled, aiChat] = await Promise.all([
    getSetting(c.env, AUDIT_ENABLED_KEY),
    getSetting(c.env, MCP_ENABLED_KEY),
    getSetting(c.env, MCP_WRITE_ENABLED_KEY),
    aiChatStatus(c.env),
  ]);
  return c.json({
    audit_log_enabled: auditEnabled === '1',
    mcp_enabled: mcpEnabled === '1',
    mcp_write_enabled: mcpWriteEnabled === '1',
    ai_chat_enabled: aiChat.enabled,
    ai_chat_provider: aiChat.provider,
    ai_chat_model: aiChat.model,
    ai_chat_has_token: aiChat.has_token,
    ai_chat_token_last4: aiChat.token_last4,
  });
});

// PUT /v1/admin/settings/audit-log  body: { enabled: boolean }
// Enabling starts recording every action (user + system). Disabling stops
// recording AND wipes all existing entries — "stop and forget".
settings.put('/audit-log', async (c) => {
  const actor = c.get('user');
  const body = await c.req.json<{ enabled?: boolean }>();
  const enabled = body.enabled === true;

  await setSetting(c.env, AUDIT_ENABLED_KEY, enabled ? '1' : null);

  if (enabled) {
    // setSetting busted the KV cache, so recordAudit now sees the flag as on —
    // make the enable itself the first entry of the fresh log.
    await recordAudit(c.env, {
      projectId: null,
      userId: actor.id,
      action: 'audit_log.enable',
      targetType: 'deployment',
    });
  } else {
    await c.env.DB.prepare(`DELETE FROM audit_log`).run();
  }

  return c.json({ audit_log_enabled: enabled });
});

// PUT /v1/admin/settings/mcp  body: { enabled: boolean }
// Master switch for the MCP server. When off, /v1/mcp returns 404.
settings.put('/mcp', async (c) => {
  const actor = c.get('user');
  const body = await c.req.json<{ enabled?: boolean }>();
  const enabled = body.enabled === true;

  await setSetting(c.env, MCP_ENABLED_KEY, enabled ? '1' : null);
  // Disabling the server also disarms write tools, so the next enable starts
  // from the safe (read-only) default rather than silently re-arming control.
  if (!enabled) await setSetting(c.env, MCP_WRITE_ENABLED_KEY, null);

  await recordAudit(c.env, {
    projectId: null,
    userId: actor.id,
    action: enabled ? 'mcp.enable' : 'mcp.disable',
    targetType: 'deployment',
  });

  return c.json({ mcp_enabled: enabled, ...(enabled ? {} : { mcp_write_enabled: false }) });
});

// PUT /v1/admin/settings/mcp-write  body: { enabled: boolean }
// Gates the management/control tools (incl. set_variable). No-op unless MCP is
// already on. Default off so an LLM can never command hardware without an
// explicit second opt-in.
settings.put('/mcp-write', async (c) => {
  const actor = c.get('user');
  const body = await c.req.json<{ enabled?: boolean }>();
  const enabled = body.enabled === true;

  if (enabled && (await getSetting(c.env, MCP_ENABLED_KEY)) !== '1') {
    return c.json({ error: 'bad_request', reason: 'mcp_disabled' }, 400);
  }

  await setSetting(c.env, MCP_WRITE_ENABLED_KEY, enabled ? '1' : null);

  await recordAudit(c.env, {
    projectId: null,
    userId: actor.id,
    action: enabled ? 'mcp.write_enable' : 'mcp.write_disable',
    targetType: 'deployment',
  });

  return c.json({ mcp_write_enabled: enabled });
});

// PUT /v1/admin/settings/ai-chat
// body: { enabled: boolean, provider?, api_key?, model?, clear_token?: boolean }
// Master switch for the AI assistant (owner/admin see it; off → chat endpoints
// 404). Supplying provider + api_key seals a BYO-token config; clear_token drops
// it so the chat falls back to Workers AI. The raw token is never read back.
settings.put('/ai-chat', async (c) => {
  const actor = c.get('user');
  const body = await c.req.json<{
    enabled?: boolean;
    provider?: string;
    api_key?: string;
    model?: string | null;
    clear_token?: boolean;
  }>();
  const enabled = body.enabled === true;

  await setAiChatEnabled(c.env, enabled);

  if (body.clear_token === true) {
    await setAiChatConfig(c.env, null);
  } else if (body.api_key && body.api_key.trim() !== '') {
    if (!AI_CHAT_PROVIDERS.includes(body.provider as AiChatProvider)) {
      return c.json({ error: 'bad_request', reason: 'invalid_provider' }, 400);
    }
    await setAiChatConfig(c.env, {
      provider: body.provider as AiChatProvider,
      apiKey: body.api_key.trim(),
      model: body.model?.trim() || undefined,
    });
  }

  await recordAudit(c.env, {
    projectId: null,
    userId: actor.id,
    action: enabled ? 'ai_chat.enable' : 'ai_chat.disable',
    targetType: 'deployment',
  });

  return c.json(await aiChatStatus(c.env));
});

export default settings;
