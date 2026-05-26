import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireProjectToken, type ProjectTokenContextVars } from '../../platform/middleware/require-project-token';
import { dispatchEvent } from '../../platform/engine/run';

const events = new Hono<{ Bindings: Env; Variables: ProjectTokenContextVars }>();

events.use('*', requireProjectToken);

// Body: { event: string, payload?: object }
// Fires any enabled `event` automation whose trigger matches `event`. Action
// execution runs in the background so hardware isn't blocked on outbound calls.
// Response: 204 No Content.
events.post('/', async (c) => {
  const body = await c.req
    .json<{ event?: string; payload?: Record<string, unknown> }>()
    .catch(() => ({} as { event?: string; payload?: Record<string, unknown> }));

  const event = (body.event ?? '').trim();
  if (!event) return c.json({ error: 'bad_request', reason: 'missing_event' }, 400);

  const { project_id } = c.get('projectToken');
  c.executionCtx.waitUntil(
    dispatchEvent(c.env, project_id, event, body.payload)
      .then(() => undefined)
      .catch((e) => console.error('event dispatch failed', project_id, event, e))
  );

  return c.body(null, 204);
});

export default events;
