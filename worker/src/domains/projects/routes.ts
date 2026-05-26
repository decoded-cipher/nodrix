import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession, type UserContextVars } from '../../platform/middleware/require-session';
import { recordAudit } from '../../platform/lib/audit';
import { userCanAccessProject } from '../../platform/lib/roles';
import { projectStub } from '../../platform/durable-objects/stubs';
import { createProject, updateProject, listAccessibleProjects } from './service';
import { actorFromSession, serviceErrorResponse } from '../../platform/lib/service';

const projects = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

projects.use('*', requireSession);

projects.get('/', async (c) => {
  return c.json({ projects: await listAccessibleProjects(c.env, actorFromSession(c.get('user'))) });
});

projects.post('/', async (c) => {
  const body = await c.req.json<{ name?: string }>();
  try {
    const p = await createProject(c.env, actorFromSession(c.get('user')), { name: body.name ?? '' });
    return c.json(p, 201);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

// PATCH /v1/admin/projects/:proj  body: { name?, description? }
projects.patch('/:proj', async (c) => {
  const projId = c.req.param('proj');
  const body = await c.req.json<{ name?: string; description?: string | null }>();
  try {
    const row = await updateProject(c.env, actorFromSession(c.get('user')), projId, {
      name: body.name,
      ...('description' in body ? { description: body.description ?? null } : {}),
    });
    return c.json(row);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

// POST /v1/admin/projects/:proj/flush  -> { flushed, keys, newCursor }
// Forces the Project DO alarm to run now. Handy for smoke tests + ops; nothing
// on the hot path depends on this.
projects.post('/:proj/flush', async (c) => {
  const projId = c.req.param('proj');
  const user = c.get('user');
  if (!(await userCanAccessProject(c.env, user.id, projId))) return c.json({ error: 'forbidden' }, 403);

  const result = await projectStub(c.env, projId).flushNow();
  return c.json(result);
});

// Cascade: wipes the project's Project DO (which owns R2 telemetry history, not
// covered by D1 FK cascade), then deletes the D1 row — which cascades dashboards,
// project_variables, project_tokens, user_tokens, project_members via FK.
//
// Dashboard DOs are intentionally NOT destroyed here: that was an RPC per
// dashboard. Each one's only D1-backed row disappears via the cascade, so on any
// reconnect its bootstrap returns dashboard_not_found and closes; an idle DO with
// no alarm and a few bytes of SQLite costs effectively nothing.
projects.delete('/:proj', async (c) => {
  const projId = c.req.param('proj');
  const user = c.get('user');

  if (!(await userCanAccessProject(c.env, user.id, projId))) return c.json({ error: 'forbidden' }, 403);

  // The project's own DO holds all variable state + R2 telemetry history.
  try {
    await projectStub(c.env, projId).destroy();
  } catch (e) {
    console.error('project DO destroy failed', projId, e);
  }

  await c.env.DB.prepare(`DELETE FROM projects WHERE id = ?`).bind(projId).run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'project.delete',
      targetType: 'project',
      targetId: projId,
    })
  );

  return c.body(null, 204);
});

export default projects;
