import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../../platform/middleware/require-project-token';
import { dispatchEvent } from '../../platform/engine/run';
import { eventPayloadTooLarge, MAX_EVENT_NAME, MAX_EVENT_PAYLOAD_BYTES } from './validate';

const events = new Hono<{ Bindings: Env; Variables: ProjectTokenContextVars }>();

events.use('*', requireProjectToken);

// Body: { event: string, payload?: object }
// Fires any enabled `event` automation whose trigger matches `event`. Action
// execution runs in the background so hardware isn't blocked on outbound calls.
// Response: 204 No Content.
events.post('/', async (c) => {
  const len = Number(c.req.header('content-length') ?? '0');
  if (Number.isFinite(len) && len > MAX_EVENT_PAYLOAD_BYTES + 1024) {
    return c.json({ error: 'payload_too_large' }, 413);
  }
  const body = await c.req
    .json<{ event?: string; payload?: Record<string, unknown> }>()
    .catch(() => ({} as { event?: string; payload?: Record<string, unknown> }));

  const event = (body.event ?? '').trim();
  if (!event) return c.json({ error: 'bad_request', reason: 'missing_event' }, 400);
  if (event.length > MAX_EVENT_NAME) return c.json({ error: 'bad_request', reason: 'event_too_long' }, 400);
  const payload = body.payload && typeof body.payload === 'object' && !Array.isArray(body.payload) ? body.payload : undefined;
  if (eventPayloadTooLarge(payload)) return c.json({ error: 'payload_too_large' }, 413);

  const { project_id } = c.get('projectToken');
  c.executionCtx.waitUntil(
    dispatchEvent(c.env, project_id, event, payload)
      .then(() => undefined)
      .catch((e) => console.error('event dispatch failed', project_id, event, e))
  );

  return c.body(null, 204);
});

export default events;
