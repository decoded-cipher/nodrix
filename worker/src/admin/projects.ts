import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import type { ProjectDO } from '../do/project-do';

const projects = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

projects.use('*', requireSession);

projects.get('/', async (c) => {
  const user = c.get('user');
  const rows = await c.env.DB
    .prepare(
      `SELECT p.id, p.name, p.description,
              p.created_at, p.updated_at, p.archived_at
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
        WHERE pm.user_id = ?
        ORDER BY p.created_at ASC`
    )
    .bind(user.id)
    .all<{
      id: string;
      name: string;
      description: string | null;
      created_at: number;
      updated_at: number;
      archived_at: number | null;
    }>();
  return c.json({ projects: rows.results });
});

projects.post('/', async (c) => {
  const body = await c.req.json<{ name?: string }>();
  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'bad_request', reason: 'missing_name' }, 400);

  const user = c.get('user');
  const id = newId('project');
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO projects (id, name, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .bind(id, name, user.id, now, now),
    c.env.DB
      .prepare(
        `INSERT INTO project_members (user_id, project_id, role, added_at, added_by)
         VALUES (?, ?, 'owner', ?, ?)`
      )
      .bind(user.id, id, now, user.id),
  ]);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: id,
      userId: user.id,
      action: 'project.create',
      targetType: 'project',
      targetId: id,
      metadata: { name },
    })
  );

  return c.json({ id, name, created_at: now, updated_at: now }, 201);
});

// PATCH /v1/admin/projects/:proj  body: { name?, description? }
projects.patch('/:proj', async (c) => {
  const projId = c.req.param('proj');
  const user = c.get('user');

  const member = await c.env.DB
    .prepare(`SELECT role FROM project_members WHERE user_id = ? AND project_id = ?`)
    .bind(user.id, projId)
    .first<{ role: string }>();
  if (!member) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<{
    name?: string;
    description?: string | null;
  }>();

  const sets: string[] = [];
  const vals: unknown[] = [];
  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = ?'); vals.push(body.name.trim());
  }
  if ('description' in body) { sets.push('description = ?'); vals.push(body.description ?? null); }
  if (sets.length === 0) return c.json({ error: 'bad_request', reason: 'no_fields' }, 400);

  const now = Math.floor(Date.now() / 1000);
  sets.push('updated_at = ?'); vals.push(now);
  vals.push(projId);

  await c.env.DB
    .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: projId,
      userId: user.id,
      action: 'project.update',
      targetType: 'project',
      targetId: projId,
      metadata: { fields: Object.keys(body) },
    })
  );

  const row = await c.env.DB
    .prepare(
      `SELECT id, name, description, created_at, updated_at, archived_at
         FROM projects WHERE id = ?`
    )
    .bind(projId)
    .first();
  return c.json(row);
});

// POST /v1/admin/projects/:proj/flush  -> { flushed, keys, newCursor }
// Forces the Project DO alarm to run now. Handy for smoke tests + ops; nothing
// on the hot path depends on this.
projects.post('/:proj/flush', async (c) => {
  const projId = c.req.param('proj');
  const user = c.get('user');
  const member = await c.env.DB
    .prepare(`SELECT role FROM project_members WHERE user_id = ? AND project_id = ?`)
    .bind(user.id, projId)
    .first<{ role: string }>();
  if (!member) return c.json({ error: 'forbidden' }, 403);

  const stub = c.env.PROJECT_DO.get(c.env.PROJECT_DO.idFromName(projId)) as unknown as ProjectDO;
  const result = await stub.flushNow();
  return c.json(result);
});

// Cascade: destroys the project's Project DO (with R2 telemetry history) and
// every Dashboard DO in the project, then deletes the D1 row (which cascades
// dashboards, project_variables, project_tokens, user_tokens, project_members
// via FK).
projects.delete('/:proj', async (c) => {
  const projId = c.req.param('proj');
  const user = c.get('user');

  const member = await c.env.DB
    .prepare(`SELECT role FROM project_members WHERE user_id = ? AND project_id = ?`)
    .bind(user.id, projId)
    .first<{ role: string }>();
  if (!member || member.role !== 'owner') return c.json({ error: 'forbidden' }, 403);

  // Gather dashboard DO IDs to destroy BEFORE the D1 delete cascades rows away.
  const dashboardRows = await c.env.DB
    .prepare(`SELECT id FROM dashboards WHERE project_id = ?`)
    .bind(projId)
    .all<{ id: string }>();

  // The project's own DO holds all variable state + R2 telemetry history.
  const projectDestroy = (async () => {
    try {
      const stub = c.env.PROJECT_DO.get(c.env.PROJECT_DO.idFromName(projId)) as unknown as ProjectDO;
      await stub.destroy();
    } catch (e) {
      console.error('project DO destroy failed', projId, e);
    }
  })();

  await Promise.all([
    projectDestroy,
    ...dashboardRows.results.map(async (d) => {
      try {
        const stub = c.env.DASHBOARD_DO.get(c.env.DASHBOARD_DO.idFromName(d.id));
        await (stub as unknown as { destroy: () => Promise<void> }).destroy();
      } catch (e) {
        console.error('dashboard destroy failed', d.id, e);
      }
    }),
  ]);

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
