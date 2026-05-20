import type { Env } from '../env';

// Append-only audit log writer. Fire-and-forget: callers pass
// `c.executionCtx.waitUntil(recordAudit(...))` so request latency doesn't
// depend on the D1 insert. Failures are logged and swallowed — the audit log
// is best-effort, not a transactional consistency boundary.

export type AuditTargetType =
  | 'project'
  | 'variable'
  | 'project_token'
  | 'dashboard'
  | 'token'
  | 'automation'
  | 'integration'
  | 'user'
  | 'session'
  | 'deployment';

export async function recordAudit(
  env: Env,
  args: {
    projectId: string | null;
    userId: string | null;
    action: string;
    targetType?: AuditTargetType | null;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
  }
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB
      .prepare(
        `INSERT INTO audit_log (project_id, user_id, action, target_type, target_id, metadata, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .bind(
        args.projectId,
        args.userId,
        args.action,
        args.targetType ?? null,
        args.targetId ?? null,
        args.metadata ? JSON.stringify(args.metadata) : null,
        now
      )
      .run();
  } catch (e) {
    console.error('audit insert failed', args.action, e);
  }
}
