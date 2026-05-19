// Auto-migrator.
//
// Replaces the old "create-everything-if-no-users" bootstrap with a real
// migration tracker. On the first request after a deploy, the Worker reads
// the d1_migrations table to find out what's been applied, then runs each
// bundled migration that's missing — in order — recording each as applied.
//
// Behaviour for the three deployment states:
//
//   1. Fresh deploy (no users, no d1_migrations).
//      Creates d1_migrations, then applies every bundled migration. The
//      DELETE FROM statements inside 0004_auth are no-ops on the empty
//      tables 0001 just created; end state matches running the SQL by hand.
//
//   2. Existing deploy that pre-dates the auto-migrator (users exist but
//      d1_migrations doesn't). We can't safely re-run 0001-0004 against
//      live data — 0004's DELETEs would wipe the deployment. So we BASELINE:
//      mark every migration listed in BASELINE_MIGRATIONS as applied
//      without running it, assuming the prior inline runMigrations or
//      `wrangler d1 migrations apply` got the DB to that state. New
//      migrations (0005+) then apply normally.
//
//   3. Already-tracked deploy. Trivial: apply whatever's missing.
//
// Once a migration's name lands in BASELINE_MIGRATIONS it's a permanent
// commitment: any deploy that ever ran THIS code will treat that migration
// as applied. So only add to it on the initial release of the auto-migrator.

import type { D1Database } from '@cloudflare/workers-types';
import { MIGRATIONS } from './migrations.gen';

// Migrations that were applied on existing deployments before the auto-
// migrator shipped. These are baselined (marked applied without running)
// when we encounter a bootstrapped DB without a d1_migrations table.
const BASELINE_MIGRATIONS = new Set<string>([
  '0001_init',
  '0002_schema_v2',
  '0003_user_names',
  '0004_auth',
]);

// Module-level guard: at most one migration check per Worker isolate. The
// promise is preserved across requests; if it failed, we null it out so
// the next request retries. Successful runs short-circuit immediately.
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
  // 1. Tracking table — first thing. applied_at=0 means "claimed but not
  //    yet completed" so we can detect partial applications (see below).
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS d1_migrations (
         name        TEXT PRIMARY KEY,
         applied_at  INTEGER NOT NULL
       )`
    )
    .run();

  // 2. Read what's already applied.
  const result = await db
    .prepare(`SELECT name, applied_at FROM d1_migrations`)
    .all<{ name: string; applied_at: number }>();
  const applied = new Set(result.results.filter((r) => r.applied_at > 0).map((r) => r.name));
  const stuck = result.results.filter((r) => r.applied_at === 0).map((r) => r.name);

  // 3. Recovery: rows with applied_at=0 were claimed but the run never
  //    completed (worker crashed mid-migration). Drop them so the loop
  //    below retries from scratch.
  if (stuck.length > 0) {
    console.warn(`[migrate] recovering stuck claims: ${stuck.join(', ')}`);
    for (const name of stuck) {
      await db
        .prepare(`DELETE FROM d1_migrations WHERE name = ? AND applied_at = 0`)
        .bind(name)
        .run();
    }
  }

  // 4. Baseline backfill for pre-auto-migrator deployments. Detect this
  //    via: tracking table just got created (applied set empty) AND the
  //    users table already has rows. Marking 0001-0004 as applied avoids
  //    re-running 0004's destructive DELETEs against live data.
  if (applied.size === 0) {
    let bootstrapped = false;
    try {
      const row = await db
        .prepare(`SELECT 1 AS one FROM users LIMIT 1`)
        .first<{ one: number }>();
      bootstrapped = row !== null;
    } catch {
      // users table doesn't exist — genuinely fresh deploy.
    }
    if (bootstrapped) {
      console.log('[migrate] existing deploy detected — baselining pre-existing migrations');
      const now = Math.floor(Date.now() / 1000);
      for (const m of MIGRATIONS) {
        if (!BASELINE_MIGRATIONS.has(m.name)) continue;
        await db
          .prepare(`INSERT OR IGNORE INTO d1_migrations (name, applied_at) VALUES (?, ?)`)
          .bind(m.name, now)
          .run();
        applied.add(m.name);
      }
    }
  }

  // 5. Apply anything outstanding, in lexical order (which matches the
  //    numeric prefix on the filenames).
  for (const m of MIGRATIONS) {
    if (applied.has(m.name)) continue;

    // Claim the row first. INSERT OR IGNORE keeps two concurrent isolates
    // from running the same DDL twice — second one's changes count is 0
    // and we skip ahead.
    const claim = await db
      .prepare(`INSERT OR IGNORE INTO d1_migrations (name, applied_at) VALUES (?, ?)`)
      .bind(m.name, 0)
      .run();
    if (claim.meta.changes === 0) {
      console.log(`[migrate] ${m.name} claimed by another isolate, skipping`);
      continue;
    }

    console.log(`[migrate] applying ${m.name} (${m.statements.length} statements)`);
    try {
      for (const stmt of m.statements) {
        await db.prepare(stmt).run();
      }
      const now = Math.floor(Date.now() / 1000);
      await db
        .prepare(`UPDATE d1_migrations SET applied_at = ? WHERE name = ?`)
        .bind(now, m.name)
        .run();
      console.log(`[migrate] applied ${m.name}`);
    } catch (e) {
      // Roll back the claim so we'll retry on the next request after the
      // underlying issue is fixed.
      await db
        .prepare(`DELETE FROM d1_migrations WHERE name = ? AND applied_at = 0`)
        .bind(m.name)
        .run();
      throw e;
    }
  }
}
