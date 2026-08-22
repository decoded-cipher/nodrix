// Auto-migrator. On the first request after a deploy, applies bundled migrations
// that haven't run yet, tracked in d1_migrations.
//
// One db.batch() per migration: D1 runs it as a single transaction, so a failure
// part-way leaves the database untouched. exec() — which D1's migration docs
// recommend — stops on error without rolling back.

import type { D1Database } from '@cloudflare/workers-types';
import { MIGRATIONS } from './migrations.gen';

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

  // applied_at = 0 means the batch rolled back; releasing the claim is the
  // whole of the recovery.
  for (const r of res.results) {
    if (r.applied_at === 0) {
      await db.prepare(`DELETE FROM d1_migrations WHERE name = ? AND applied_at = 0`).bind(r.name).run();
    }
  }

  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;

    // INSERT OR IGNORE keeps two concurrent isolates from running the same DDL.
    const claim = await db
      .prepare(`INSERT OR IGNORE INTO d1_migrations (name, applied_at) VALUES (?, 0)`)
      .bind(m.name)
      .run();
    if (claim.meta.changes === 0) continue;

    console.log(`[migrate] applying ${m.name} (${m.statements.length} statements)`);
    try {
      await db.batch([
        ...m.statements.map((s) => db.prepare(s)),
        db
          .prepare(`UPDATE d1_migrations SET applied_at = ? WHERE name = ?`)
          .bind(Math.floor(Date.now() / 1000), m.name),
      ]);
      console.log(`[migrate] applied ${m.name}`);
    } catch (e) {
      await db.prepare(`DELETE FROM d1_migrations WHERE name = ? AND applied_at = 0`).bind(m.name).run();
      throw e;
    }
  }
}
