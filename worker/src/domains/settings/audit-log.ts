import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession, type UserContextVars } from '../../platform/middleware/require-session';
import { safeParse } from '../../platform/lib/sql';

const auditLog = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

auditLog.use('*', requireSession);

//   &action=<category>  (prefix, e.g. "project" → project.create/update/…)
//   &project=<id|none>  &user=<id|system>  &from=<unix>  &to=<unix>
// Account-wide log. Owner/admin see every entry; a member sees entries from the
// projects they're assigned to, plus project-less entries they authored.
// Page-based pagination (offset under the hood) — fine at our scale.
auditLog.get('/', async (c) => {
  const user = c.get('user');
  const instanceAdmin = user.role === 'owner' || user.role === 'admin';

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

  // Owner/admin: no scope filter. Member: their projects + own project-less entries.
  const conds: string[] = [
    instanceAdmin
      ? `1 = 1`
      : `(a.project_id IN (SELECT project_id FROM project_members WHERE user_id = ?)
          OR (a.project_id IS NULL AND a.user_id = ?))`,
  ];
  const binds: unknown[] = instanceAdmin ? [] : [user.id, user.id];

  // Optional filters (AND-ed onto the scope).
  const action = (c.req.query('action') ?? '').trim();
  if (action) { conds.push(`a.action LIKE ?`); binds.push(`${action}.%`); }

  const project = (c.req.query('project') ?? '').trim();
  if (project === 'none') conds.push(`a.project_id IS NULL`);
  else if (project) { conds.push(`a.project_id = ?`); binds.push(project); }

  const actor = (c.req.query('user') ?? '').trim();
  if (actor === 'system') conds.push(`a.user_id IS NULL`);
  else if (actor) { conds.push(`a.user_id = ?`); binds.push(actor); }

  const from = parseInt(c.req.query('from') ?? '', 10);
  if (Number.isFinite(from)) { conds.push(`a.created_at >= ?`); binds.push(from); }
  const to = parseInt(c.req.query('to') ?? '', 10);
  if (Number.isFinite(to)) { conds.push(`a.created_at <= ?`); binds.push(to); }

  const where = conds.join(' AND ');

  const [totalRow, rows] = await Promise.all([
    c.env.DB
      .prepare(`SELECT COUNT(*) AS n FROM audit_log a WHERE ${where}`)
      .bind(...binds)
      .first<{ n: number }>(),
    c.env.DB
      .prepare(
        `SELECT a.id, a.project_id, p.name AS project_name,
                a.user_id, u.email AS user_email,
                a.action, a.target_type, a.target_id, a.metadata, a.created_at
           FROM audit_log a
           LEFT JOIN users u    ON u.id = a.user_id
           LEFT JOIN projects p ON p.id = a.project_id
          WHERE ${where}
          ORDER BY a.id DESC
          LIMIT ? OFFSET ?`
      )
      .bind(...binds, limit, offset)
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

export default auditLog;
