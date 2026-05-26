import type { Env } from '../../env';
import { newId } from '../../platform/lib/ids';
import { recordAudit } from '../../platform/lib/audit';
import { executeIntegration, recordIntegrationRun } from '../../platform/engine/integrations';
import type { AutomationContext, IntegrationRow as EngineIntegrationRow } from '../../platform/engine/types';
import { safeParse, buildUpdate } from '../../platform/lib/sql';
import { type Actor, ServiceError } from '../../platform/lib/service';
import { assertProjectAccess } from '../projects/service';

const KINDS = ['webhook', 'code_block', 'slack', 'email', 'mqtt', 'http_service'] as const;
type Kind = (typeof KINDS)[number];

// Full D1 row = the engine's column projection plus the admin-facing metadata.
type IntegrationRow = EngineIntegrationRow & {
  created_at: number;
  updated_at: number;
  archived_at: number | null;
  last_run_at: number | null;
  last_run_status: 'ok' | 'error' | 'skipped' | null;
  last_error: string | null;
};

// Raw shape (config parsed, NOT redacted). The HTTP admin API shows secrets to
// the logged-in human; MCP redaction is applied at the tool layer (see
// mcp/redact.ts) so it never leaks the real config to a model.
export type IntegrationShape = ReturnType<typeof shape>;

function shape(r: IntegrationRow) {
  return {
    id: r.id,
    project_id: r.project_id,
    name: r.name,
    kind: r.kind,
    config: safeParse(r.config),
    enabled: r.enabled === 1,
    created_at: r.created_at,
    updated_at: r.updated_at,
    last_run_at: r.last_run_at,
    last_run_status: r.last_run_status,
    last_error: r.last_error,
  };
}

// Mirrors GET /v1/admin/projects/:proj/integrations.
export async function listIntegrations(env: Env, projectId: string): Promise<IntegrationShape[]> {
  const rows = await env.DB
    .prepare(
      `SELECT id, project_id, name, kind, config, enabled,
              created_at, updated_at, archived_at,
              last_run_at, last_run_status, last_error
         FROM integrations WHERE project_id = ? AND archived_at IS NULL
         ORDER BY created_at DESC`
    )
    .bind(projectId)
    .all<IntegrationRow>();
  return rows.results.map(shape);
}

export async function createIntegration(
  env: Env,
  actor: Actor,
  projectId: string,
  input: { name: string; kind: string; config?: unknown; enabled?: boolean }
): Promise<IntegrationShape> {
  await assertProjectAccess(env, actor, projectId);
  const name = (input.name ?? '').trim();
  if (!name) throw new ServiceError('bad_request', 'name is required', 'missing_name');
  if (!KINDS.includes(input.kind as Kind)) {
    throw new ServiceError('bad_request', 'invalid kind', 'invalid_kind');
  }

  const id = newId('integration');
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(
      `INSERT INTO integrations
         (id, project_id, name, kind, config, enabled, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, projectId, name, input.kind, JSON.stringify(input.config ?? {}), input.enabled === false ? 0 : 1, actor.userId, now, now)
    .run();

  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: 'integration.create',
    targetType: 'integration',
    targetId: id,
    metadata: { name, kind: input.kind, source: actor.source },
  });
  const row = await env.DB.prepare(`SELECT * FROM integrations WHERE id = ?`).bind(id).first<IntegrationRow>();
  return shape(row!);
}

export async function updateIntegration(
  env: Env,
  actor: Actor,
  projectId: string,
  id: string,
  input: { name?: string; config?: unknown; enabled?: boolean }
): Promise<IntegrationShape> {
  await assertProjectAccess(env, actor, projectId);
  const existing = await env.DB
    .prepare(`SELECT id FROM integrations WHERE id = ? AND project_id = ?`)
    .bind(id, projectId)
    .first<{ id: string }>();
  if (!existing) throw new ServiceError('not_found', 'integration not found');

  const u = buildUpdate({
    name: typeof input.name === 'string' && input.name.trim() ? input.name.trim() : undefined,
    config: 'config' in input ? JSON.stringify(input.config ?? {}) : undefined,
    enabled: typeof input.enabled === 'boolean' ? (input.enabled ? 1 : 0) : undefined,
  });
  if (!u) throw new ServiceError('bad_request', 'no fields to update', 'no_fields');

  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE integrations SET ${u.clause}, updated_at = ? WHERE id = ? AND project_id = ?`)
    .bind(...u.values, now, id, projectId)
    .run();

  const providedCount = Object.values(input).filter((v) => v !== undefined).length;
  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: typeof input.enabled === 'boolean' && providedCount === 1
      ? `integration.${input.enabled ? 'enable' : 'disable'}`
      : 'integration.update',
    targetType: 'integration',
    targetId: id,
    metadata: { source: actor.source },
  });
  const row = await env.DB.prepare(`SELECT * FROM integrations WHERE id = ?`).bind(id).first<IntegrationRow>();
  return shape(row!);
}

// Fire the connection once with a synthetic context. Records the outcome.
export async function testIntegration(
  env: Env,
  actor: Actor,
  projectId: string,
  id: string
) {
  await assertProjectAccess(env, actor, projectId);
  const row = await env.DB
    .prepare(
      `SELECT id, project_id, name, kind, config, enabled
         FROM integrations WHERE id = ? AND project_id = ? AND archived_at IS NULL`
    )
    .bind(id, projectId)
    .first<{ id: string; project_id: string; name: string; kind: string; config: string; enabled: number }>();
  if (!row) throw new ServiceError('not_found', 'integration not found');

  const ctx: AutomationContext = {
    source: 'manual',
    projectId,
    ts: Math.floor(Date.now() / 1000),
    variable: 'test_variable',
    value: 42,
    event: 'test',
    depth: 0,
  };
  const result = await executeIntegration(env, { ...row, enabled: 1 }, ctx, { test: true });
  await recordIntegrationRun(env, id, result).catch(() => {});

  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: 'integration.test',
    targetType: 'integration',
    targetId: id,
    metadata: { status: result.status, source: actor.source, ...(result.detail ? { detail: result.detail } : {}) },
  });
  return result;
}
