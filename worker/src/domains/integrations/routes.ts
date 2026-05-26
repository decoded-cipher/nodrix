import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession } from '../../platform/middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../../platform/middleware/resolve-project';
import { recordAudit } from '../../platform/lib/audit';
import { listIntegrations, createIntegration, updateIntegration, testIntegration } from './service';
import { actorFromSession, serviceErrorResponse } from '../../platform/lib/service';

const integrations = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

integrations.use('*', requireSession);
integrations.use('*', resolveProject);

// GET /v1/admin/projects/:proj/integrations
integrations.get('/', async (c) => {
  const project = c.get('project');
  return c.json({ integrations: await listIntegrations(c.env, project.id) });
});

// POST /v1/admin/projects/:proj/integrations
integrations.post('/', async (c) => {
  const project = c.get('project');
  const body = await c.req.json<{ name?: string; kind?: string; config?: unknown; enabled?: boolean }>();
  try {
    const i = await createIntegration(c.env, actorFromSession(c.get('user')), project.id, {
      name: body.name ?? '',
      kind: body.kind ?? '',
      config: body.config,
      enabled: body.enabled,
    });
    return c.json(i, 201);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

// Fires the connection once with a synthetic context so users can verify
// delivery without wiring up an automation. Records the outcome on the row.
integrations.post('/:id/test', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  try {
    const result = await testIntegration(c.env, actorFromSession(c.get('user')), project.id, id);
    return c.json(result);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

// PATCH /v1/admin/projects/:proj/integrations/:id
integrations.patch('/:id', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; config?: unknown; enabled?: boolean }>();
  try {
    const i = await updateIntegration(c.env, actorFromSession(c.get('user')), project.id, id, {
      name: body.name,
      ...('config' in body ? { config: body.config } : {}),
      enabled: body.enabled,
    });
    return c.json(i);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

// DELETE /v1/admin/projects/:proj/integrations/:id  (soft delete via archived_at)
integrations.delete('/:id', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const id = c.req.param('id');
  const now = Math.floor(Date.now() / 1000);

  const res = await c.env.DB
    .prepare(
      `UPDATE integrations SET archived_at = ?, updated_at = ?
        WHERE id = ? AND project_id = ? AND archived_at IS NULL`
    )
    .bind(now, now, id, project.id)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'integration.delete',
      targetType: 'integration',
      targetId: id,
    })
  );
  return c.body(null, 204);
});

export default integrations;
