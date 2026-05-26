import { createMiddleware } from 'hono/factory';
import type { Env } from '../../env';
import type { UserContextVars } from './require-session';

export type ProjectContextVars = UserContextVars & {
  project: { id: string; name: string };
};

// Validates :proj and gates access: instance owner/admin reach every project; a
// `member` reaches a project iff they have a project_members row for it.
// Everyone who passes has full control (no per-project role), so there's no
// separate write gate — mounting this is enough for reads and writes on the
// project sub-routers.
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
      `SELECT p.id, p.name, pm.user_id AS member
         FROM projects p
         LEFT JOIN project_members pm
           ON pm.project_id = p.id AND pm.user_id = ?
        WHERE p.id = ?`
    )
    .bind(user.id, projectId)
    .first<{ id: string; name: string; member: string | null }>();

  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!instanceAdmin && !row.member) return c.json({ error: 'forbidden' }, 403);

  c.set('project', { id: row.id, name: row.name });
  await next();
});
