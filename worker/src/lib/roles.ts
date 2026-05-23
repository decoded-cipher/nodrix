// Effective project role resolution, usable from both the Worker and a Durable
// Object (takes a userId rather than a session). Instance owner/admin get
// implicit project `admin` on every project; otherwise it's the
// project_members.role, or null when the user has no access.

import type { Env } from '../env';

export type ProjectRole = 'admin' | 'viewer';

export async function effectiveProjectRole(
  env: Env,
  userId: string,
  projectId: string
): Promise<ProjectRole | null> {
  const u = await env.DB
    .prepare(`SELECT role FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ role: string }>();
  if (!u) return null;
  if (u.role === 'owner' || u.role === 'admin') return 'admin';

  const m = await env.DB
    .prepare(`SELECT role FROM project_members WHERE user_id = ? AND project_id = ?`)
    .bind(userId, projectId)
    .first<{ role: ProjectRole }>();
  return m?.role ?? null;
}
