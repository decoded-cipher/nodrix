import type { Env } from '../../env';
import { type Actor, ServiceError } from '../../platform/lib/service';
import { newId } from '../../platform/lib/ids';
import { recordAudit } from '../../platform/lib/audit';
import { validateLayout } from '../../platform/lib/layout';
import { safeParse } from '../../platform/lib/sql';
import { assertProjectAccess } from '../projects/service';

export type DashboardSummary = {
  id: string;
  name: string;
  description: string | null;
  visibility: 'private' | 'public';
  share_token: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
};

// Mirrors GET /v1/admin/projects/:proj/dashboards.
export async function listDashboards(env: Env, projectId: string): Promise<DashboardSummary[]> {
  const rows = await env.DB
    .prepare(
      `SELECT id, name, description, visibility, share_token,
              created_at, updated_at, archived_at
         FROM dashboards WHERE project_id = ? ORDER BY created_at ASC`
    )
    .bind(projectId)
    .all<DashboardSummary>();
  return rows.results;
}

// Mirrors GET /v1/admin/projects/:proj/dashboards/:id (layout parsed). Throws
// not_found if the dashboard isn't in this project.
export async function getDashboard(
  env: Env,
  projectId: string,
  id: string
): Promise<DashboardSummary & { layout: unknown }> {
  const row = await env.DB
    .prepare(
      `SELECT id, name, description, layout, visibility, share_token,
              created_at, updated_at, archived_at
         FROM dashboards WHERE id = ? AND project_id = ?`
    )
    .bind(id, projectId)
    .first<DashboardSummary & { layout: string }>();
  if (!row) throw new ServiceError('not_found', 'dashboard not found');
  return { ...row, layout: safeParse(row.layout) };
}

export async function createDashboard(
  env: Env,
  actor: Actor,
  projectId: string,
  input: { name: string; layout?: unknown }
): Promise<DashboardSummary & { layout: unknown }> {
  await assertProjectAccess(env, actor, projectId);
  const name = (input.name ?? '').trim();
  if (!name) throw new ServiceError('bad_request', 'name is required', 'missing_name');

  const layout = input.layout ?? { grid: { columns: 24 }, items: [] };
  const v = validateLayout(layout);
  if (!v.ok) throw new ServiceError('bad_request', `invalid layout: ${v.reason}`, v.reason);

  const id = newId('dashboard');
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT INTO dashboards (id, project_id, name, layout, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, projectId, name, JSON.stringify(v.value), actor.userId, now, now)
    .run();

  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: 'dashboard.create',
    targetType: 'dashboard',
    targetId: id,
    metadata: { name, source: actor.source },
  });
  return {
    id, name, description: null, layout: v.value, visibility: 'private',
    share_token: null, created_at: now, updated_at: now, archived_at: null,
  };
}

export async function updateDashboard(
  env: Env,
  actor: Actor,
  projectId: string,
  id: string,
  input: { name?: string; description?: string | null; layout?: unknown; if_updated_at?: number }
): Promise<{ id: string; name: string; description: string | null; layout: unknown; updated_at: number }> {
  await assertProjectAccess(env, actor, projectId);

  const current = await env.DB
    .prepare(`SELECT name, description, layout, updated_at FROM dashboards WHERE id = ? AND project_id = ?`)
    .bind(id, projectId)
    .first<{ name: string; description: string | null; layout: string; updated_at: number }>();
  if (!current) throw new ServiceError('not_found', 'dashboard not found');

  if (typeof input.if_updated_at === 'number' && input.if_updated_at !== current.updated_at) {
    throw new ServiceError('conflict', 'dashboard was modified since you read it', 'stale_write');
  }

  const nextName = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : current.name;
  const nextDescription =
    input.description === undefined
      ? current.description
      : typeof input.description === 'string' && input.description.trim()
        ? input.description.trim()
        : null;

  let nextLayoutJson = current.layout;
  if (input.layout !== undefined) {
    const v = validateLayout(input.layout);
    if (!v.ok) throw new ServiceError('bad_request', `invalid layout: ${v.reason}`, v.reason);
    nextLayoutJson = JSON.stringify(v.value);
  }

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE dashboards SET name = ?, description = ?, layout = ?, updated_at = ? WHERE id = ? AND project_id = ?`)
    .bind(nextName, nextDescription, nextLayoutJson, now, id, projectId)
    .run();

  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: 'dashboard.update',
    targetType: 'dashboard',
    targetId: id,
    metadata: { layout_changed: input.layout !== undefined, source: actor.source },
  });
  return { id, name: nextName, description: nextDescription, layout: JSON.parse(nextLayoutJson), updated_at: now };
}
