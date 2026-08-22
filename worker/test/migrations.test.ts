// A fresh install and an upgraded one have to arrive at the same schema, and the
// upgrade has to keep its data. Runs the real bundled statements against SQLite.
// Run with `bun test worker/test/migrations.test.ts`.

import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from '../src/platform/db/migrations.gen';

function apply(db: Database, upTo: number) {
  for (const m of MIGRATIONS.slice(0, upTo)) {
    for (const stmt of m.statements) db.run(stmt);
  }
}

// Ordered so two databases built by different routes compare directly.
function schemaOf(db: Database): string {
  const rows = db
    .query<{ type: string; name: string; sql: string | null }, []>(
      `SELECT type, name, sql FROM sqlite_master
       WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
    )
    .all();
  return rows.map((r) => `${r.type} ${r.name}\n${r.sql ?? ''}`).join('\n---\n');
}

function seed(db: Database) {
  db.run(`INSERT INTO users (id, email, name, role, created_at, updated_at)
          VALUES ('usr_1', 'a@b.c', 'A', 'owner', 1, 1)`);
  db.run(`INSERT INTO projects (id, name, created_by, created_at, updated_at)
          VALUES ('prj_alpha', 'Alpha', 'usr_1', 100, 100),
                 ('prj_beta', 'Beta', 'usr_1', 200, 200)`);
  db.run(`INSERT INTO project_variables (id, project_id, key, unit, created_at, updated_at, last_seen)
          VALUES ('var_1', 'prj_alpha', 'temp', 'C', 100, 100, 500),
                 ('var_2', 'prj_alpha', 'humidity', NULL, 100, 100, 600),
                 ('var_3', 'prj_beta', 'temp', NULL, 200, 200, NULL)`);
}

test('fresh and upgraded instances reach an identical schema', () => {
  const upgraded = new Database(':memory:');
  apply(upgraded, 1);
  seed(upgraded);
  apply(upgraded, MIGRATIONS.length);

  const fresh = new Database(':memory:');
  apply(fresh, MIGRATIONS.length);

  expect(schemaOf(upgraded)).toBe(schemaOf(fresh));
});

test('the upgrade runs clean against an instance with no rows', () => {
  const db = new Database(':memory:');
  apply(db, 1);
  expect(() => apply(db, MIGRATIONS.length)).not.toThrow();
  expect(db.query(`SELECT COUNT(*) AS n FROM devices`).get()).toEqual({ n: 0 });
});

test('every project gets exactly one default device', () => {
  const db = new Database(':memory:');
  apply(db, 1);
  seed(db);
  apply(db, MIGRATIONS.length);

  const devices = db
    .query<{ id: string; project_id: string; name: string; is_default: number }, []>(
      `SELECT id, project_id, name, is_default FROM devices ORDER BY project_id`
    )
    .all();
  expect(devices).toEqual([
    { id: 'dev_alpha', project_id: 'prj_alpha', name: 'Default', is_default: 1 },
    { id: 'dev_beta', project_id: 'prj_beta', name: 'Default', is_default: 1 },
  ]);
});

test('a second default device cannot be inserted', () => {
  const db = new Database(':memory:');
  apply(db, 1);
  seed(db);
  apply(db, MIGRATIONS.length);
  expect(() =>
    db.run(`INSERT INTO devices (id, project_id, name, is_default, created_at)
            VALUES ('dev_x', 'prj_alpha', 'Second', 1, 1)`)
  ).toThrow();
});

test('existing variables survive and land on their default device', () => {
  const db = new Database(':memory:');
  apply(db, 1);
  seed(db);
  apply(db, MIGRATIONS.length);

  const rows = db
    .query<{ id: string; project_id: string; device_id: string; key: string; unit: string | null; last_seen: number | null }, []>(
      `SELECT id, project_id, device_id, key, unit, last_seen FROM project_variables ORDER BY id`
    )
    .all();
  expect(rows).toEqual([
    { id: 'var_1', project_id: 'prj_alpha', device_id: 'dev_alpha', key: 'temp', unit: 'C', last_seen: 500 },
    { id: 'var_2', project_id: 'prj_alpha', device_id: 'dev_alpha', key: 'humidity', unit: null, last_seen: 600 },
    { id: 'var_3', project_id: 'prj_beta', device_id: 'dev_beta', key: 'temp', unit: null, last_seen: null },
  ]);
});

test('the same key is now allowed once per device', () => {
  const db = new Database(':memory:');
  apply(db, 1);
  seed(db);
  apply(db, MIGRATIONS.length);

  db.run(`INSERT INTO devices (id, project_id, name, created_at) VALUES ('dev_two', 'prj_alpha', 'Shed', 1)`);
  expect(() =>
    db.run(`INSERT INTO project_variables (id, project_id, device_id, key, created_at, updated_at)
            VALUES ('var_4', 'prj_alpha', 'dev_two', 'temp', 1, 1)`)
  ).not.toThrow();
  expect(() =>
    db.run(`INSERT INTO project_variables (id, project_id, device_id, key, created_at, updated_at)
            VALUES ('var_5', 'prj_alpha', 'dev_alpha', 'temp', 1, 1)`)
  ).toThrow();
});

test('a device points at desired firmware and survives its deletion', () => {
  const db = new Database(':memory:');
  db.run('PRAGMA foreign_keys = ON');
  apply(db, 1);
  seed(db);
  apply(db, MIGRATIONS.length);

  db.run(`INSERT INTO firmware (id, project_id, version, size, sha256, r2_key, created_at)
          VALUES ('fw_1', 'prj_alpha', '1.4.0', 100, 'abc', 'k', 1)`);
  db.run(`UPDATE devices SET desired_firmware_id = 'fw_1' WHERE id = 'dev_alpha'`);
  db.run(`DELETE FROM firmware WHERE id = 'fw_1'`);

  // ON DELETE SET NULL, so the device stays; it just has nothing pending.
  const row = db.query(`SELECT desired_firmware_id FROM devices WHERE id = 'dev_alpha'`).get();
  expect(row).toEqual({ desired_firmware_id: null });
});

test('one firmware version per project', () => {
  const db = new Database(':memory:');
  apply(db, 1);
  seed(db);
  apply(db, MIGRATIONS.length);
  const insert = (id: string, project: string) =>
    db.run(`INSERT INTO firmware (id, project_id, version, size, sha256, r2_key, created_at)
            VALUES ('${id}', '${project}', '1.0.0', 1, 'a', 'k', 1)`);
  insert('fw_a', 'prj_alpha');
  expect(() => insert('fw_b', 'prj_beta')).not.toThrow();
  expect(() => insert('fw_c', 'prj_alpha')).toThrow();
});

// The baseline is all CREATE ... IF NOT EXISTS, including the index whose columns
// 0002 changes. Replaying it must not put the old shape back.
test('replaying the baseline over a migrated database changes nothing', () => {
  const db = new Database(':memory:');
  apply(db, MIGRATIONS.length);
  const before = schemaOf(db);
  apply(db, 1);
  expect(schemaOf(db)).toBe(before);
});
