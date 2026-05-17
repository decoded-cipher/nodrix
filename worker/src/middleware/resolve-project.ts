import { createMiddleware } from 'hono/factory';
import type { Env } from '../env';
import type { UserContextVars } from './resolve-user';

export type ProjectContextVars = UserContextVars & {
  project: { id: string; name: string };
};

// Validates :proj path param and the user's membership.
export const resolveProject = createMiddleware<{
  Bindings: Env;
  Variables: ProjectContextVars;
}>(async (c, next) => {
  const projectId = c.req.param('proj');
  if (!projectId) return c.json({ error: 'bad_request', reason: 'missing_project' }, 400);

  const user = c.get('user');
  const row = await c.env.DB
    .prepare(
      `SELECT p.id, p.name
         FROM projects p
         JOIN project_members pm ON pm.project_id = p.id
        WHERE p.id = ? AND pm.user_id = ?`
    )
    .bind(projectId, user.id)
    .first<{ id: string; name: string }>();
  if (!row) return c.json({ error: 'forbidden' }, 403);

  c.set('project', row);
  await next();
});
