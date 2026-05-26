import type { Env } from '../../env';
import { getSetting } from './deployment-settings';

// Append-only audit log writer. Fire-and-forget: callers pass
// `c.executionCtx.waitUntil(recordAudit(...))` so request latency doesn't
// depend on the D1 insert. Failures are logged and swallowed — the audit log
// is best-effort, not a transactional consistency boundary.
//
// Audit logging is OPT-IN: off by default, toggled in Settings → More. Every
// write (user- AND system-originated) goes through recordAudit, so gating it
// here turns the whole log on/off in one place. A system action is just an
// entry with userId = null (e.g. automation.run from the engine).

// deployment_settings key for the on/off flag; '1' = enabled, absent = disabled.
export const AUDIT_ENABLED_KEY = 'audit_log_enabled';

export async function isAuditEnabled(env: Env): Promise<boolean> {
  return (await getSetting(env, AUDIT_ENABLED_KEY)) === '1';
}

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
  // Opt-in: skip the write entirely when audit logging is disabled.
  if (!(await isAuditEnabled(env))) return;

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
