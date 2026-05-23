import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import type { UserContextVars } from './require-session';

export type ProjectRole = 'admin' | 'viewer';

export type ProjectContextVars = UserContextVars & {
  project: { id: string; name: string; role: ProjectRole };
};

// Validates :proj and resolves the caller's EFFECTIVE role on it:
//   - instance owner/admin → implicit project `admin` on every project (so they
//     can see & share any project), even without a project_members row;
//   - otherwise the project_members.role, or 403 if not a member.
export const resolveProject = createMiddleware<{
  Bindings: Env;
  Variables: ProjectContextVars;
}>(async (c, next) => {
  const projectId = c.req.param('proj');
  if (!projectId) return c.json({ error: 'bad_request', reason: 'missing_project' }, 400);

  const user = c.get('user');
  const instanceAdmin = user.role === 'owner' || user.role === 'admin';

  const row = await c.env.DB
    .prepare(
      `SELECT p.id, p.name, pm.role AS member_role
         FROM projects p
         LEFT JOIN project_members pm
           ON pm.project_id = p.id AND pm.user_id = ?
        WHERE p.id = ?`
    )
    .bind(user.id, projectId)
    .first<{ id: string; name: string; member_role: ProjectRole | null }>();

  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!instanceAdmin && !row.member_role) return c.json({ error: 'forbidden' }, 403);

  const role: ProjectRole = instanceAdmin ? 'admin' : (row.member_role as ProjectRole);
  c.set('project', { id: row.id, name: row.name, role });
  await next();
});

// Gate for write/manage routes: requires effective project role `admin`.
// Mount AFTER resolveProject.
export const requireProjectAdmin = createMiddleware<{
  Bindings: Env;
  Variables: ProjectContextVars;
}>(async (c, next) => {
  const project = c.get('project');
  if (!project || project.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  await next();
});

// Method-aware variant for the project sub-routers: GET/HEAD are readable by
// viewers; any mutating method requires effective project role `admin`. Mount
// AFTER resolveProject, before the route handlers.
export const requireProjectAdminForWrites = createMiddleware<{
  Bindings: Env;
  Variables: ProjectContextVars;
}>(async (c, next) => {
  const method = c.req.method.toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    const project = c.get('project');
    if (!project || project.role !== 'admin') return c.json({ error: 'forbidden' }, 403);
  }
  await next();
});
