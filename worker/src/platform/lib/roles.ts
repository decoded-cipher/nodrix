// Project access, usable from both the Worker and a Durable Object (takes a
// userId rather than a session). Access is binary, with no per-project role:
// owner/admin reach every project; a `member` reaches a project iff they have a
// project_members row for it. Everyone with access has full control.

import type { Env } from '../../env';

export async function userCanAccessProject(
  env: Env,
  userId: string,
  projectId: string
): Promise<boolean> {
  const u = await env.DB
    .prepare(`SELECT role FROM users WHERE id = ?`)
    .bind(userId)
    .first<{ role: string }>();
  if (!u) return false;
  if (u.role === 'owner' || u.role === 'admin') return true;

  const m = await env.DB
    .prepare(`SELECT 1 AS ok FROM project_members WHERE user_id = ? AND project_id = ?`)
    .bind(userId, projectId)
    .first<{ ok: number }>();
  return !!m;
}
