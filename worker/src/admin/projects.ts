import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';
import { recordAudit } from '../lib/audit';
import type { ProjectDO } from '../do/project-do';
import { createProject, updateProject } from '../services/projects';
import { actorFromSession, serviceErrorResponse } from '../lib/service-http';

const projects = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

projects.use('*', requireSession);

// Project access: instance owner/admin reach every project; a member reaches a
// project iff they have a project_members row. No per-project role — access is
// full when granted.
async function canAccess(env: Env, user: { id: string; role: string }, projId: string): Promise<boolean> {
  if (user.role === 'owner' || user.role === 'admin') return true;
  const m = await env.DB
    .prepare(`SELECT 1 AS ok FROM project_members WHERE user_id = ? AND project_id = ?`)
    .bind(user.id, projId)
    .first<{ ok: number }>();
  return !!m;
}

projects.get('/', async (c) => {
  const user = c.get('user');
  const instanceAdmin = user.role === 'owner' || user.role === 'admin';

  // Instance owner/admin see every project; members see only the projects
  // they're assigned to.
  const rows = instanceAdmin
    ? await c.env.DB
        .prepare(
          `SELECT p.id, p.name, p.description, p.created_at, p.updated_at, p.archived_at
             FROM projects p
            ORDER BY p.created_at ASC`
        )
        .all()
    : await c.env.DB
        .prepare(
          `SELECT p.id, p.name, p.description, p.created_at, p.updated_at, p.archived_at
             FROM projects p
             JOIN project_members pm ON pm.project_id = p.id
            WHERE pm.user_id = ?
            ORDER BY p.created_at ASC`
        )
        .bind(user.id)
        .all();
  return c.json({ projects: rows.results });
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
  if (!(await canAccess(c.env, user, projId))) return c.json({ error: 'forbidden' }, 403);

  const stub = c.env.PROJECT_DO.get(c.env.PROJECT_DO.idFromName(projId)) as unknown as ProjectDO;
  const result = await stub.flushNow();
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

  if (!(await canAccess(c.env, user, projId))) return c.json({ error: 'forbidden' }, 403);

  // The project's own DO holds all variable state + R2 telemetry history.
  try {
    const stub = c.env.PROJECT_DO.get(c.env.PROJECT_DO.idFromName(projId)) as unknown as ProjectDO;
    await stub.destroy();
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
