// Auto-creates project_variables rows on first sight and refreshes last_seen.
// Shared by the HTTP telemetry route and the DO's WebSocket path so both behave the same.

import type { Env } from '../../env';
import { newId } from '../../platform/lib/ids';
import { chunk, MAX_BOUND_PARAMS } from '../../platform/lib/sql';

// Bounds variable growth from a device that spams fresh keys.
const MAX_VARIABLES_PER_PROJECT = 250;

// In-isolate throttle so a chatty device doesn't rewrite last_seen on every ingest.
const LAST_SEEN_THROTTLE_MS = 60_000;
const lastSeenWrites = new Map<string, number>();

function dueForLastSeen(projectId: string, key: string, nowMs: number): boolean {
  const k = `${projectId}:${key}`;
  const prev = lastSeenWrites.get(k);
  if (prev !== undefined && nowMs - prev < LAST_SEEN_THROTTLE_MS) return false;
  lastSeenWrites.set(k, nowMs);
  if (lastSeenWrites.size > 10_000) {
    const cutoff = nowMs - LAST_SEEN_THROTTLE_MS;
    for (const [mk, t] of lastSeenWrites) if (t < cutoff) lastSeenWrites.delete(mk);
  }
  return true;
}

export async function upsertVariables(
  env: Env,
  projectId: string,
  keys: string[],
  now: number
): Promise<void> {
  const nowMs = Date.now();
  const due = [...new Set(keys)].filter((key) => dueForLastSeen(projectId, key, nowMs));
  if (due.length === 0) return;
  try {
    // Existing keys only refresh last_seen; new keys count against the cap. Chunk the
    // IN(...) under the bound-param limit (project_id takes one slot).
    const existing = new Set<string>();
    for (const part of chunk(due, MAX_BOUND_PARAMS - 1)) {
      const placeholders = part.map(() => '?').join(',');
      const rows = await env.DB
        .prepare(`SELECT key FROM project_variables WHERE project_id = ? AND key IN (${placeholders})`)
        .bind(projectId, ...part)
        .all<{ key: string }>();
      for (const r of rows.results) existing.add(r.key);
    }

    let toCreate = due.filter((key) => !existing.has(key));
    if (toCreate.length > 0) {
      const countRow = await env.DB
        .prepare(`SELECT COUNT(*) AS n FROM project_variables WHERE project_id = ?`)
        .bind(projectId)
        .first<{ n: number }>();
      toCreate = toCreate.slice(0, Math.max(0, MAX_VARIABLES_PER_PROJECT - (countRow?.n ?? 0)));
    }

    const keysToWrite = [...existing, ...toCreate];
    if (keysToWrite.length === 0) return;
    await env.DB.batch(
      keysToWrite.map((key) =>
        env.DB
          .prepare(
            `INSERT INTO project_variables (id, project_id, key, created_at, updated_at, last_seen)
             VALUES (?, ?, ?, ?, ?, ?)
             ON CONFLICT(project_id, key) DO UPDATE SET last_seen = excluded.last_seen`
          )
          .bind(newId('variable'), projectId, key, now, now, now)
      )
    );
  } catch {
    // Best-effort — never fail telemetry on it. Clear stamps so a failed write retries next ingest.
    for (const key of due) lastSeenWrites.delete(`${projectId}:${key}`);
  }
}
