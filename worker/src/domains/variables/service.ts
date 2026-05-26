import type { Env } from '../../env';
import { newId } from '../../platform/lib/ids';
import { recordAudit } from '../../platform/lib/audit';
import { projectStub } from '../../platform/durable-objects/stubs';
import { type Actor, ServiceError } from '../../platform/lib/service';
import { assertProjectAccess } from '../projects/service';

export type VariableSummary = {
  id: string;
  key: string;
  unit: string | null;
  created_at: number;
  updated_at: number;
  last_seen: number | null;
};

// Declared variables for a project. Mirrors GET /v1/projects/:proj/variables.
export async function listVariables(env: Env, projectId: string): Promise<VariableSummary[]> {
  const rows = await env.DB
    .prepare(
      `SELECT id, key, unit, created_at, updated_at, last_seen
         FROM project_variables WHERE project_id = ? ORDER BY key ASC`
    )
    .bind(projectId)
    .all<VariableSummary>();
  return rows.results;
}

export type StateEntry = { value: unknown; received_at: number };

// Latest value of every variable. Mirrors GET /v1/projects/:proj/state.
export async function getState(env: Env, projectId: string): Promise<Record<string, StateEntry>> {
  const latest = await projectStub(env, projectId).getLatestState();
  const out: Record<string, StateEntry> = {};
  for (const r of latest) out[r.variable] = { value: r.value, received_at: r.received_at };
  return out;
}

// Recent points from the Project DO ring buffer (never R2). Mirrors
export async function getSeries(
  env: Env,
  projectId: string,
  variable: string,
  windowStr: string
): Promise<{ window: string; points: unknown[] }> {
  const now = Math.floor(Date.now() / 1000);
  const m = /^(\d+)([smh])$/.exec(windowStr);
  let seconds = 60 * 60;
  if (m) {
    const n = Number(m[1]);
    seconds = m[2] === 'h' ? n * 3600 : m[2] === 'm' ? n * 60 : n;
  }
  const points = await projectStub(env, projectId).getSeries(variable, now - seconds);
  return { window: m ? windowStr : '1h', points };
}

// Declare a variable. Telemetry also auto-creates variables on first sight, so
// this is for declaring ahead of data (e.g. to set a unit).
export async function createVariable(
  env: Env,
  actor: Actor,
  projectId: string,
  input: { key: string; unit?: string | null }
): Promise<VariableSummary> {
  await assertProjectAccess(env, actor, projectId);
  const key = (input.key ?? '').trim();
  if (!key) throw new ServiceError('bad_request', 'key is required', 'missing_key');

  const id = newId('variable');
  const now = Math.floor(Date.now() / 1000);
  try {
    await env.DB
      .prepare(
        `INSERT INTO project_variables (id, project_id, key, unit, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, projectId, key, input.unit ?? null, now, now)
      .run();
  } catch {
    throw new ServiceError('conflict', 'a variable with this key already exists', 'duplicate_key');
  }

  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: 'variable.create',
    targetType: 'variable',
    targetId: id,
    metadata: { key, source: actor.source },
  });
  return { id, key, unit: input.unit ?? null, created_at: now, updated_at: now, last_seen: null };
}

// Update a variable's unit.
export async function updateVariable(
  env: Env,
  actor: Actor,
  projectId: string,
  id: string,
  input: { unit: string | null }
): Promise<VariableSummary> {
  await assertProjectAccess(env, actor, projectId);
  const now = Math.floor(Date.now() / 1000);
  const res = await env.DB
    .prepare(`UPDATE project_variables SET unit = ?, updated_at = ? WHERE id = ? AND project_id = ?`)
    .bind(input.unit ?? null, now, id, projectId)
    .run();
  if (res.meta.changes === 0) throw new ServiceError('not_found', 'variable not found');

  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: 'variable.update',
    targetType: 'variable',
    targetId: id,
    metadata: { source: actor.source },
  });
  const row = await env.DB
    .prepare(`SELECT id, key, unit, created_at, updated_at, last_seen FROM project_variables WHERE id = ?`)
    .bind(id)
    .first<VariableSummary>();
  return row!;
}

// Enqueue a cloud→hardware control write. The hardware picks it up on its next
// /v1/control poll (or the control WebSocket). This is the sharpest tool in the
// set — an LLM steering a device — so the MCP layer gates it behind an
// admin-scope token AND the mcp_write_enabled flag.
export async function setVariableControl(
  env: Env,
  actor: Actor,
  projectId: string,
  input: { variable: string; value: unknown }
): Promise<{ id: string; variable: string; value: unknown }> {
  await assertProjectAccess(env, actor, projectId);
  const variable = (input.variable ?? '').trim();
  if (!variable) throw new ServiceError('bad_request', 'variable is required', 'missing_variable');

  // The variable must already exist in the project (mirrors the dashboard
  // control path, which refuses variable_not_in_project).
  const exists = await env.DB
    .prepare(`SELECT 1 AS ok FROM project_variables WHERE project_id = ? AND key = ?`)
    .bind(projectId, variable)
    .first<{ ok: number }>();
  if (!exists) throw new ServiceError('not_found', 'variable not in project', 'variable_not_in_project');

  const id = newId('control');
  await projectStub(env, projectId).addControl(id, variable, input.value ?? null);

  await recordAudit(env, {
    projectId,
    userId: actor.userId,
    action: 'variable.control',
    targetType: 'variable',
    targetId: variable,
    metadata: { value: input.value ?? null, source: actor.source },
  });
  return { id, variable, value: input.value ?? null };
}
