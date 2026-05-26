// Auto-migrator. On the first request after a deploy, applies any bundled
// migrations (worker/src/db/migrations/*.sql, baked into migrations.gen.ts) that
// haven't run yet, tracked in the d1_migrations table.
//
// nodrix is pre-alpha: there's a single baseline migration and instances are
// recreated fresh, so there's no legacy-baseline handling — just "apply what's
// missing, in order." Concurrent isolates are guarded by an INSERT OR IGNORE
// claim; a crash mid-migration leaves applied_at=0, which the next run retries.

import type { D1Database } from '@cloudflare/workers-types';
import { MIGRATIONS } from './migrations.gen';

// Module-level guard: at most one migration check per Worker isolate. If it
// failed we null it out so the next request retries.
let inFlight: Promise<void> | null = null;

export function ensureMigrated(db: D1Database): Promise<void> {
  if (!inFlight) {
    inFlight = applyMigrations(db).catch((e) => {
      console.error('[migrate] failed:', e);
      inFlight = null;
      throw e;
    });
  }
  return inFlight;
}

async function applyMigrations(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS d1_migrations (
         name       TEXT PRIMARY KEY,
         applied_at INTEGER NOT NULL
       )`
    )
    .run();

  const res = await db
    .prepare(`SELECT name, applied_at FROM d1_migrations`)
    .all<{ name: string; applied_at: number }>();
  const applied = new Set(res.results.filter((r) => r.applied_at > 0).map((r) => r.name));

  // Recover claims that never completed (worker crashed mid-migration) so the
  // loop below retries them from scratch.
  for (const r of res.results) {
    if (r.applied_at === 0) {
      await db.prepare(`DELETE FROM d1_migrations WHERE name = ? AND applied_at = 0`).bind(r.name).run();
    }
  }

  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;

    // Claim first — INSERT OR IGNORE keeps two concurrent isolates from running
    // the same DDL twice (second one's changes count is 0, so it skips).
    const claim = await db
      .prepare(`INSERT OR IGNORE INTO d1_migrations (name, applied_at) VALUES (?, 0)`)
      .bind(m.name)
      .run();
    if (claim.meta.changes === 0) continue;

    console.log(`[migrate] applying ${m.name} (${m.statements.length} statements)`);
    try {
      for (const stmt of m.statements) await db.prepare(stmt).run();
      await db
        .prepare(`UPDATE d1_migrations SET applied_at = ? WHERE name = ?`)
        .bind(Math.floor(Date.now() / 1000), m.name)
        .run();
      console.log(`[migrate] applied ${m.name}`);
    } catch (e) {
      // Roll back the claim so we retry on a later request.
      await db.prepare(`DELETE FROM d1_migrations WHERE name = ? AND applied_at = 0`).bind(m.name).run();
      throw e;
    }
  }
}
