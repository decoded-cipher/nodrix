import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';

const auditLog = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

auditLog.use('*', requireSession);

// GET /v1/admin/audit-log?limit=15&page=1
// Account-wide log: entries from every project the caller is a member of,
// plus entries with project_id IS NULL authored by the caller. Page-based
// pagination (offset under the hood) — fine at our scale.
auditLog.get('/', async (c) => {
  const user = c.get('user');

  const limit = clampInt(c.req.query('limit'), 1, 200, 15);
  const page = clampInt(c.req.query('page'), 1, Number.MAX_SAFE_INTEGER, 1);
  const offset = (page - 1) * limit;

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

  const baseWhere = `
    (a.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?1)
     OR (a.project_id IS NULL AND a.user_id = ?1))
  `;

  const [totalRow, rows] = await Promise.all([
    c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM audit_log a WHERE ${baseWhere}`)
      .bind(user.id)
      .first<{ n: number }>(),
    c.env.DB
      .prepare(
        `SELECT a.id, a.project_id, p.name AS project_name,
                a.user_id, u.email AS user_email,
                a.action, a.target_type, a.target_id, a.metadata, a.created_at
           FROM audit_log a
           LEFT JOIN users u    ON u.id = a.user_id
           LEFT JOIN projects p ON p.id = a.project_id
          WHERE ${baseWhere}
          ORDER BY a.id DESC
          LIMIT ?2 OFFSET ?3`
      )
      .bind(user.id, limit, offset)
      .all<Row>(),
  ]);

  const total = totalRow?.n ?? 0;
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

  return c.json({
    entries,
    total,
    page,
    page_size: limit,
    page_count: Math.max(1, Math.ceil(total / limit)),
  });
});

function clampInt(raw: string | undefined, min: number, max: number, fallback: number): number {
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(n, min), max);
}

function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}

export default auditLog;
