import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession } from '../../platform/middleware/require-session';
import { resolveProject, type ProjectContextVars } from '../../platform/middleware/resolve-project';
import { shareToken } from '../../platform/lib/ids';
import { recordAudit } from '../../platform/lib/audit';
import { dashboardStub } from '../../platform/durable-objects/stubs';
import { createDashboard, updateDashboard, listDashboards, getDashboard } from './service';
import { actorFromSession, serviceErrorResponse } from '../../platform/lib/service';

const dashboards = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

dashboards.use('*', requireSession);
dashboards.use('*', resolveProject);

// GET /v1/admin/projects/:proj/dashboards
dashboards.get('/', async (c) => {
  const project = c.get('project');
  return c.json({ dashboards: await listDashboards(c.env, project.id) });
});

// GET /v1/admin/projects/:proj/dashboards/:id
dashboards.get('/:id', async (c) => {
  const project = c.get('project');
  try {
    return c.json(await getDashboard(c.env, project.id, c.req.param('id')));
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

// POST /v1/admin/projects/:proj/dashboards  body: { name, layout }
dashboards.post('/', async (c) => {
  const project = c.get('project');
  const body = await c.req.json<{ name?: string; layout?: unknown }>();
  try {
    const d = await createDashboard(c.env, actorFromSession(c.get('user')), project.id, {
      name: body.name ?? '',
      layout: body.layout,
    });
    return c.json(d, 201);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

// PUT /v1/admin/projects/:proj/dashboards/:id  body: { name?, description?, layout?, if_updated_at? }
dashboards.put('/:id', async (c) => {
  const project = c.get('project');
  const id = c.req.param('id');
  const body = await c.req.json<{
    name?: string;
    description?: string | null;
    layout?: unknown;
    if_updated_at?: number;
  }>();
  try {
    const d = await updateDashboard(c.env, actorFromSession(c.get('user')), project.id, id, {
      name: body.name,
      ...('description' in body ? { description: body.description ?? null } : {}),
      layout: body.layout,
      if_updated_at: body.if_updated_at,
    });
    return c.json(d);
  } catch (e) {
    return serviceErrorResponse(c, e);
  }
});

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
    await dashboardStub(c.env, id).destroy();
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

// A shared dashboard is world-readable (read-only) at an unguessable URL. The
// token lives in the URL, so it's a capability, not a password: we store it in
// plaintext (the column was designed for exactly this — see 0001_init.sql) so
// the share dialog can re-display the link and the public read path can look it
// up by a direct match. The data is, by definition, already meant to be public.

// Idempotent "make public": creates a share token if none exists, leaves an
// existing one untouched so a re-publish doesn't gratuitously break a live link.
// To rotate a leaked link, unshare (DELETE clears the token) then share again —
// the next publish mints a fresh one.
dashboards.post('/:id/share', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const id = c.req.param('id');

  const row = await c.env.DB
    .prepare(`SELECT share_token FROM dashboards WHERE id = ? AND project_id = ?`)
    .bind(id, project.id)
    .first<{ share_token: string | null }>();
  if (!row) return c.json({ error: 'not_found' }, 404);

  const token = row.share_token ?? shareToken();
  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare(
      `UPDATE dashboards SET visibility = 'public', share_token = ?, updated_at = ?
        WHERE id = ? AND project_id = ?`
    )
    .bind(token, now, id, project.id)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'dashboard.share',
      targetType: 'dashboard',
      targetId: id,
    })
  );

  return c.json({ id, visibility: 'public', share_token: token, updated_at: now });
});

// Make private again and kill the link. Distinct path from DELETE /:id, so the
// dashboard itself is untouched.
dashboards.delete('/:id/share', async (c) => {
  const project = c.get('project');
  const user = c.get('user');
  const id = c.req.param('id');

  const row = await c.env.DB
    .prepare(`SELECT id FROM dashboards WHERE id = ? AND project_id = ?`)
    .bind(id, project.id)
    .first<{ id: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);

  const now = Math.floor(Date.now() / 1000);
  await c.env.DB
    .prepare(
      `UPDATE dashboards SET visibility = 'private', share_token = NULL, updated_at = ?
        WHERE id = ? AND project_id = ?`
    )
    .bind(now, id, project.id)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: project.id,
      userId: user.id,
      action: 'dashboard.unshare',
      targetType: 'dashboard',
      targetId: id,
    })
  );

  return c.json({ id, visibility: 'private', share_token: null, updated_at: now });
});

export default dashboards;
