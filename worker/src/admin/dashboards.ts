import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess } from '../middleware/require-access';
import { resolveUser } from '../middleware/resolve-user';
import { resolveProject, type ProjectContextVars } from '../middleware/resolve-project';
import { newId } from '../lib/ids';
import { recordAudit } from '../lib/audit';
import { validateLayout, devicesFromLayout } from '../lib/layout';

const dashboards = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

dashboards.use('*', requireAccess);
dashboards.use('*', resolveUser);
dashboards.use('*', resolveProject);

// GET /v1/admin/projects/:proj/dashboards
dashboards.get('/', async (c) => {
  const project = c.get('project');
  const rows = await c.env.DB
    .prepare(
      `SELECT id, name, description, visibility, share_token,
              created_at, updated_at, archived_at
         FROM dashboards
        WHERE project_id = ? ORDER BY created_at ASC`
    )
    .bind(project.id)
    .all<{
      id: string;
      name: string;
      description: string | null;
      visibility: 'private' | 'public';
      share_token: string | null;
      created_at: number;
      updated_at: number;
      archived_at: number | null;
    }>();
  return c.json({ dashboards: rows.results });
});

// GET /v1/admin/projects/:proj/dashboards/:id
dashboards.get('/:id', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const row = await c.env.DB
    .prepare(
      `SELECT id, name, description, layout, visibility, share_token,
              created_at, updated_at, archived_at
         FROM dashboards
        WHERE id = ? AND project_id = ?`
    )
    .bind(id, project.id)
    .first<{
      id: string;
      name: string;
      description: string | null;
      layout: string;
      visibility: 'private' | 'public';
      share_token: string | null;
      created_at: number;
      updated_at: number;
      archived_at: number | null;
    }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ ...row, layout: JSON.parse(row.layout) });
});

// POST /v1/admin/projects/:proj/dashboards  body: { name, layout }
dashboards.post('/', async (c) => {
  const project = c.get('project');
  const body = await c.req.json<{ name?: string; layout?: unknown }>();
  const name = (body.name ?? '').trim();
  if (!name) return c.json({ error: 'bad_request', reason: 'missing_name' }, 400);

  const layout = body.layout ?? { grid: { columns: 12 }, items: [] };
  const v = validateLayout(layout);
  if (!v.ok) return c.json({ error: 'bad_request', reason: v.reason }, 400);

  const crossProject = await containsForeignDevice(c.env.DB, project.id, devicesFromLayout(v.value));
  if (crossProject) return c.json({ error: 'bad_request', reason: 'cross_project_device' }, 400);

  const id = newId('dashboard');
  const user = c.get('user');
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB
    .prepare(
      `INSERT INTO dashboards (id, project_id, name, layout, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, project.id, name, JSON.stringify(v.value), user.id, now, now)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'dashboard.create',
      targetType: 'dashboard',
      targetId: id,
      metadata: { name },
    })
  );

  return c.json(
    { id, name, layout: v.value, visibility: 'private', created_at: now, updated_at: now },
    201
  );
});

// PUT /v1/admin/projects/:proj/dashboards/:id  body: { name?, layout?, if_updated_at? }
dashboards.put('/:id', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const body = await c.req.json<{ name?: string; layout?: unknown; if_updated_at?: number }>();

  const current = await c.env.DB
    .prepare(`SELECT name, layout, updated_at FROM dashboards WHERE id = ? AND project_id = ?`)
    .bind(id, project.id)
    .first<{ name: string; layout: string; updated_at: number }>();
  if (!current) return c.json({ error: 'not_found' }, 404);

  // Optimistic concurrency.
  if (typeof body.if_updated_at === 'number' && body.if_updated_at !== current.updated_at) {
    return c.json({ error: 'conflict', reason: 'stale_write', current_updated_at: current.updated_at }, 409);
  }

  const nextName = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : current.name;
  let nextLayoutJson: string = current.layout;
  if (body.layout !== undefined) {
    const v = validateLayout(body.layout);
    if (!v.ok) return c.json({ error: 'bad_request', reason: v.reason }, 400);
    const crossProject = await containsForeignDevice(c.env.DB, project.id, devicesFromLayout(v.value));
    if (crossProject) return c.json({ error: 'bad_request', reason: 'cross_project_device' }, 400);
    nextLayoutJson = JSON.stringify(v.value);
  }

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare(
      `UPDATE dashboards SET name = ?, layout = ?, updated_at = ? WHERE id = ? AND project_id = ?`
    )
    .bind(nextName, nextLayoutJson, now, id, project.id)
    .run();

  return c.json({ id, name: nextName, layout: JSON.parse(nextLayoutJson), updated_at: now });
});

// DELETE /v1/admin/projects/:proj/dashboards/:id
// Also wipes the Dashboard DO (subscription set + hibernated sockets).
dashboards.delete('/:id', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const id = c.req.param('id');

  const row = await c.env.DB
    .prepare(`SELECT id FROM dashboards WHERE id = ? AND project_id = ?`)
    .bind(id, project.id)
    .first<{ id: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);

  try {
    const stub = c.env.DASHBOARD_DO.get(c.env.DASHBOARD_DO.idFromName(id));
    // The DO class isn't imported as a type here (cycle avoidance); call via
    // fetch-shaped RPC instead. Use a simple method invocation through any.
    await (stub as unknown as { destroy: () => Promise<void> }).destroy();
  } catch (e) {
    console.error('dashboard destroy failed', id, e);
  }

  await c.env.DB
    .prepare(`DELETE FROM dashboards WHERE id = ? AND project_id = ?`)
    .bind(id, project.id)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'dashboard.delete',
      targetType: 'dashboard',
      targetId: id,
    })
  );

  return c.body(null, 204);
});

async function containsForeignDevice(
  db: Env['DB'],
  projectId: string,
  deviceIds: string[]
): Promise<boolean> {
  if (deviceIds.length === 0) return false;
  const placeholders = deviceIds.map(() => '?').join(',');
  const rows = await db
    .prepare(`SELECT id FROM devices WHERE id IN (${placeholders}) AND project_id = ?`)
    .bind(...deviceIds, projectId)
    .all<{ id: string }>();
  return rows.results.length !== deviceIds.length;
}

export default dashboards;
