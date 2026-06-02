import type { Env } from '../../env';
import { type Actor, isInstanceAdmin, ServiceError } from '../../platform/lib/service';
import { newId } from '../../platform/lib/ids';
import { recordAudit } from '../../platform/lib/audit';
import { buildUpdate, chunk, inClause, MAX_BOUND_PARAMS } from '../../platform/lib/sql';

// Keep only the ids that name a real project, preserving caller order. Reads just
// the requested ids (IN-list) instead of loading the whole projects table to
// filter in JS — used when validating project assignments for users/invites.
export async function filterExistingProjectIds(env: Env, ids: string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const found = new Set<string>();
  for (const part of chunk(unique, MAX_BOUND_PARAMS)) {
    const rows = await env.DB
      .prepare(`SELECT id FROM projects WHERE id IN ${inClause(part.length)}`)
      .bind(...part)
      .all<{ id: string }>();
    for (const r of rows.results) found.add(r.id);
  }
  return ids.filter((id) => found.has(id));
}

export type ProjectSummary = {
  id: string;
  name: string;
  description: string | null;
  created_at: number;
  updated_at: number;
  archived_at: number | null;
};

// Projects an actor can reach: instance owner/admin see all; a member sees only
// the projects they're assigned to. Mirrors GET /v1/admin/projects.
export async function listAccessibleProjects(env: Env, actor: Actor): Promise<ProjectSummary[]> {
  const rows = isInstanceAdmin(actor)
    ? await env.DB
        .prepare(
          `SELECT id, name, description, created_at, updated_at, archived_at
             FROM projects ORDER BY created_at ASC`
        )
        .all<ProjectSummary>()
    : await env.DB
        .prepare(
          `SELECT p.id, p.name, p.description, p.created_at, p.updated_at, p.archived_at
             FROM projects p
             JOIN project_members pm ON pm.project_id = p.id
            WHERE pm.user_id = ?
            ORDER BY p.created_at ASC`
        )
        .bind(actor.userId)
        .all<ProjectSummary>();
  return rows.results;
}

// A single project's summary, or null if it doesn't exist. No access check —
// callers that expose this must scope the id themselves.
export async function getProject(env: Env, projectId: string): Promise<ProjectSummary | null> {
  return env.DB
    .prepare(
      `SELECT id, name, description, created_at, updated_at, archived_at
         FROM projects WHERE id = ?`
    )
    .bind(projectId)
    .first<ProjectSummary>();
}

// Throws if the actor can't reach the project (404 when it doesn't exist, 403
// when it exists but isn't theirs). Returns the project's id+name on success.
export async function assertProjectAccess(
  env: Env,
  actor: Actor,
  projectId: string
): Promise<{ id: string; name: string }> {
  const row = await env.DB
    .prepare(
      `SELECT p.id, p.name, pm.user_id AS member
         FROM projects p
         LEFT JOIN project_members pm
           ON pm.project_id = p.id AND pm.user_id = ?
        WHERE p.id = ?`
    )
    .bind(actor.userId, projectId)
    .first<{ id: string; name: string; member: string | null }>();

  if (!row) throw new ServiceError('not_found', 'project not found');
  if (!isInstanceAdmin(actor) && !row.member) {
    throw new ServiceError('forbidden', 'no access to project');
  }
  return { id: row.id, name: row.name };
}

// Create a project. Members can't — they're assigned to existing projects — so
// this requires instance owner/admin, mirroring POST /v1/admin/projects.
export async function createProject(
  env: Env,
  actor: Actor,
  input: { name: string }
): Promise<ProjectSummary> {
  if (!isInstanceAdmin(actor)) throw new ServiceError('forbidden', 'only owner/admin can create projects');
  const name = (input.name ?? '').trim();
  if (!name) throw new ServiceError('bad_request', 'name is required', 'missing_name');

  const id = newId('project');
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT INTO projects (id, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, name, actor.userId, now, now)
    .run();

  await recordAudit(env, {
    projectId: id,
    userId: actor.userId,
    action: 'project.create',
    targetType: 'project',
    targetId: id,
    metadata: { name, source: actor.source },
  });
  return { id, name, description: null, created_at: now, updated_at: now, archived_at: null };
}

// Rename / re-describe a project.
export async function updateProject(
  env: Env,
  actor: Actor,
  projectId: string,
  input: { name?: string; description?: string | null }
): Promise<ProjectSummary> {
  await assertProjectAccess(env, actor, projectId);

  const u = buildUpdate({
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined,
    description: 'description' in input ? (input.description ?? null) : undefined,
  });
  if (!u) throw new ServiceError('bad_request', 'no fields to update', 'no_fields');

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE projects SET ${u.clause}, updated_at = ? WHERE id = ?`)
    .bind(...u.values, now, projectId)
    .run();

  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: 'project.update',
    targetType: 'project',
    targetId: projectId,
    metadata: { fields: Object.keys(input), source: actor.source },
  });
  const row = await getProject(env, projectId);
  return row!;
}
