import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';

const auditLog = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

auditLog.use('*', requireSession);

// GET /v1/admin/audit-log?limit=50&before=<id>
// Account-wide log: returns entries from every project the caller is a member
// of, plus entries with project_id IS NULL (e.g. project.delete) authored by
// the caller. Keyset-paginated on the auto-increment id.
auditLog.get('/', async (c) => {
  const user = c.get('user');

  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const beforeRaw = c.req.query('before');
  const before = beforeRaw ? parseInt(beforeRaw, 10) : null;

  type Row = {
    id: number;
    project_id: string | null;
    project_name: string | null;
    user_id: string | null;
    user_email: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    metadata: string | null;
    created_at: number;
  };

  // Scope: any project the caller is a member of, OR entries with a null
  // project (system-wide actions like project.delete) that the caller authored.
  const baseWhere = `
    (a.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?1)
     OR (a.project_id IS NULL AND a.user_id = ?1))
  `;

  const stmt = before !== null && Number.isFinite(before)
    ? c.env.DB
        .prepare(
          `SELECT a.id, a.project_id, p.name AS project_name,
                  a.user_id, u.email AS user_email,
                  a.action, a.target_type, a.target_id, a.metadata, a.created_at
             FROM audit_log a
             LEFT JOIN users u    ON u.id = a.user_id
             LEFT JOIN projects p ON p.id = a.project_id
            WHERE ${baseWhere} AND a.id < ?2
            ORDER BY a.id DESC
            LIMIT ?3`
        )
        .bind(user.id, before, limit)
    : c.env.DB
        .prepare(
          `SELECT a.id, a.project_id, p.name AS project_name,
                  a.user_id, u.email AS user_email,
                  a.action, a.target_type, a.target_id, a.metadata, a.created_at
             FROM audit_log a
             LEFT JOIN users u    ON u.id = a.user_id
             LEFT JOIN projects p ON p.id = a.project_id
            WHERE ${baseWhere}
            ORDER BY a.id DESC
            LIMIT ?2`
        )
        .bind(user.id, limit);

  const rows = await stmt.all<Row>();
  const entries = rows.results.map((r) => ({
    id: r.id,
    project_id: r.project_id,
    project_name: r.project_name,
    user_id: r.user_id,
    user_email: r.user_email,
    action: r.action,
    target_type: r.target_type,
    target_id: r.target_id,
    metadata: r.metadata ? safeParse(r.metadata) : null,
    created_at: r.created_at,
  }));

  const last = rows.results[rows.results.length - 1];
  return c.json({
    entries,
    next_before: rows.results.length === limit && last ? last.id : null,
  });
});

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

export default auditLog;
