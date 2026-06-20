// AI chat assistant routes, mounted at /v1/admin/projects/:proj/chat. Owner/admin
// only; when the assistant is disabled the endpoints 404 (looks absent, mirrors
// MCP). Reads stream inline; writes are proposed by the model and only executed
// by /apply after the human confirms.

import { Hono } from 'hono';
import { streamText, convertToModelMessages, stepCountIs, type UIMessage } from 'ai';
import type { Env } from '../../env';
import { requireSession } from '../../platform/middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../../platform/middleware/resolve-project';
import { actorFromSession, serviceErrorResponse } from '../../platform/lib/service';
import { aiChatEnabled } from '../settings/ai-chat';
import { resolveModel } from './model';
import { readTools, proposalTools, sanitizeMessages, systemPrompt, WRITE_TOOLS } from './tools';

const chat = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

chat.use('*', requireSession);
chat.use('*', resolveProject);
chat.use('*', async (c, next) => {
  const role = c.get('user').role;
  if (role !== 'owner' && role !== 'admin') return c.json({ error: 'forbidden', reason: 'owner_admin_only' }, 403);
  if (!(await aiChatEnabled(c.env))) return c.json({ error: 'not_found' }, 404);
  await next();
});

chat.post('/', async (c) => {
  const project = c.get('project');
  const body = await c.req.json<{ messages?: UIMessage[] }>();
  const messages = Array.isArray(body.messages) ? body.messages : [];

  const { model } = await resolveModel(c.env);
  const modelMessages = await convertToModelMessages(sanitizeMessages(messages));
  const result = streamText({
    model,
    system: systemPrompt(project.name),
    messages: modelMessages,
    tools: { ...readTools(c.env, project.id), ...proposalTools() },
    stopWhen: stepCountIs(6),
    maxOutputTokens: 1500,
  });
  return result.toUIMessageStreamResponse();
});

// Run one confirmed write. tool + input are re-validated and authorized here —
// the model only proposes; it is never trusted to execute.
chat.post('/apply', async (c) => {
  const project = c.get('project');
  const body = await c.req.json<{ tool?: string; input?: unknown }>();
  const spec = body.tool ? WRITE_TOOLS[body.tool] : undefined;
  if (!spec) return c.json({ error: 'bad_request', reason: 'unknown_tool' }, 400);

  const parsed = spec.inputSchema.safeParse(body.input ?? {});
  if (!parsed.success) return c.json({ error: 'bad_request', reason: 'invalid_input' }, 400);

  try {
    const result = await spec.run(c.env, actorFromSession(c.get('user')), project.id, parsed.data as Record<string, unknown>);
    return c.json({ ok: true, result });
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

export default chat;
