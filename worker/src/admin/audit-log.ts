import { Hono } from 'hono';
import type { Env } from '../env';
import { requireAccess } from '../middleware/require-access';
import { resolveUser } from '../middleware/resolve-user';
import { resolveProject, type ProjectContextVars } from '../middleware/resolve-project';

const auditLog = new Hono<{ Bindings: Env; Variables: ProjectContextVars }>();

auditLog.use('*', requireAccess);
auditLog.use('*', resolveUser);
auditLog.use('*', resolveProject);

// GET /v1/admin/projects/:proj/audit-log?limit=50&before=<id>
// Keyset pagination over the auto-increment id (descending). The idx_audit_log_project
// index covers (project_id, created_at DESC) so this stays cheap as the table grows.
auditLog.get('/', async (c) => {
  const project = c.get('project');

  const limitRaw = parseInt(c.req.query('limit') ?? '50', 10);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 200) : 50;
  const beforeRaw = c.req.query('before');
  const before = beforeRaw ? parseInt(beforeRaw, 10) : null;

  type Row = {
    id: number;
    project_id: string | null;
    user_id: string | null;
    user_email: string | null;
    action: string;
    target_type: string | null;
    target_id: string | null;
    metadata: string | null;
    created_at: number;
  };

  const stmt = before !== null && Number.isFinite(before)
    ? c.env.DB
        .prepare(
          `SELECT a.id, a.project_id, a.user_id, u.email AS user_email,
                  a.action, a.target_type, a.target_id, a.metadata, a.created_at
             FROM audit_log a
             LEFT JOIN users u ON u.id = a.user_id
            WHERE a.project_id = ? AND a.id < ?
            ORDER BY a.id DESC
            LIMIT ?`
        )
        .bind(project.id, before, limit)
    : c.env.DB
        .prepare(
          `SELECT a.id, a.project_id, a.user_id, u.email AS user_email,
                  a.action, a.target_type, a.target_id, a.metadata, a.created_at
             FROM audit_log a
             LEFT JOIN users u ON u.id = a.user_id
            WHERE a.project_id = ?
            ORDER BY a.id DESC
            LIMIT ?`
        )
        .bind(project.id, limit);

  const rows = await stmt.all<Row>();
  const entries = rows.results.map((r) => ({
    id: r.id,
    project_id: r.project_id,
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
