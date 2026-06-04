// Permissive auto-creation of project_variables rows on telemetry ingest, plus a
// best-effort last_seen refresh. Shared by the HTTP telemetry route and the project
// DO's WebSocket telemetry path so both transports behave identically.

import type { Env } from '../../env';
import { newId } from '../../platform/lib/ids';
import { chunk, MAX_BOUND_PARAMS } from '../../platform/lib/sql';

// Per-request caps only bound a single ingest; a device sending fresh keys across
// many requests could still grow project_variables without bound. Cap the total
// distinct auto-created variables per project.
const MAX_VARIABLES_PER_PROJECT = 250;

// Best-effort in-isolate throttle so a chatty device doesn't rewrite
// project_variables.last_seen on every ingest. Isolates are short-lived, so the
// worst case is one write per key per window per isolate — far fewer than
// per-request. A key never seen in this isolate always writes, so first-sight
// auto-creation stays immediate.
const LAST_SEEN_THROTTLE_MS = 60_000;
const lastSeenWrites = new Map<string, number>();

function dueForLastSeen(projectId: string, key: string, nowMs: number): boolean {
  const k = `${projectId}:${key}`;
  const prev = lastSeenWrites.get(k);
  if (prev !== undefined && nowMs - prev < LAST_SEEN_THROTTLE_MS) return false;
  lastSeenWrites.set(k, nowMs);
  // Soft cap: drop stale entries if the map grows large (high key cardinality).
  if (lastSeenWrites.size > 10_000) {
    const cutoff = nowMs - LAST_SEEN_THROTTLE_MS;
    for (const [mk, t] of lastSeenWrites) if (t < cutoff) lastSeenWrites.delete(mk);
  }
  return true;
}

// Permissive ingest: ensure a project_variables row exists for each key (created
// on first sight) and refresh last_seen. UNIQUE(project_id, key) makes the
// INSERT idempotent; the UPDATE keeps last_seen current for existing rows. New
// keys are created only under MAX_VARIABLES_PER_PROJECT; existing keys always refresh.
export async function upsertVariables(
  env: Env,
  projectId: string,
  keys: string[],
  now: number
): Promise<void> {
  const nowMs = Date.now();
  // Only touch keys whose last_seen is actually due (throttled per isolate).
  const due = [...new Set(keys)].filter((key) => dueForLastSeen(projectId, key, nowMs));
  if (due.length === 0) return;
  try {
    // Existing rows only need last_seen refreshed; new keys count against the cap.
    // Chunk the IN(...) lookup under the 100 bound-param limit (project_id takes one).
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
      const remaining = Math.max(0, MAX_VARIABLES_PER_PROJECT - (countRow?.n ?? 0));
      // Best-effort guardrail: a small overshoot under concurrency is acceptable
      // since the cap bounds growth rather than enforcing an exact invariant.
      toCreate = toCreate.slice(0, remaining);
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
    // last_seen + auto-create are best-effort; never fail telemetry on them.
    // Clear the throttle stamps so a failed write retries on the next ingest
    // instead of waiting out the window.
    for (const key of due) lastSeenWrites.delete(`${projectId}:${key}`);
  }
}
