// Durable Objects have no migration runner, so a project created today and one
// created before devices existed reach their schema by different routes. The
// classic divergence is silent — a column NOT NULL on one and nullable on the
// other — so the two are compared directly.
// Run with `bun test worker/test/do-schema.test.ts`.

import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { PROJECT_SCHEMA } from '../src/platform/durable-objects/project-schema';

// SqlStorage.exec(sql, ...binds) over bun:sqlite, which is what the steps expect.
function storage(db: Database) {
  return { exec: (sql: string, ...binds: unknown[]) => db.run(sql, ...(binds as never[])) };
}

function applySteps(db: Database, from: number, to: number) {
  const sql = storage(db) as never;
  for (let i = from; i < to; i++) PROJECT_SCHEMA[i]!(sql);
}

function schemaOf(db: Database): string {
  return db
    .query<{ type: string; name: string; sql: string | null }, []>(
      `SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type, name`
    )
    .all()
    .map((r) => `${r.type} ${r.name}\n${r.sql ?? ''}`)
    .join('\n---\n');
}

test('an object built step by step matches one built fresh', () => {
  const stepped = new Database(':memory:');
  for (let i = 0; i < PROJECT_SCHEMA.length; i++) applySteps(stepped, i, i + 1);

  const fresh = new Database(':memory:');
  applySteps(fresh, 0, PROJECT_SCHEMA.length);

  expect(schemaOf(stepped)).toBe(schemaOf(fresh));
});

test('rows written before devices existed land on the default device', () => {
  const db = new Database(':memory:');
  applySteps(db, 0, 1);
  db.run(`INSERT INTO latest_state (variable, value, received_at) VALUES ('temp', '21', 100)`);
  db.run(`INSERT INTO ring_buffer (ts, variable, value) VALUES (100, 'temp', '21')`);
  applySteps(db, 1, PROJECT_SCHEMA.length);

  expect(db.query(`SELECT device_id, variable FROM latest_state`).all())
    .toEqual([{ device_id: '', variable: 'temp' }]);
  expect(db.query(`SELECT device_id FROM ring_buffer`).all()).toEqual([{ device_id: '' }]);
});

// The reason '' is the sentinel rather than NULL: SQLite treats NULLs as
// distinct in a unique key, so the upsert would append instead of updating.
test('the default device upserts rather than duplicating', () => {
  const db = new Database(':memory:');
  applySteps(db, 0, PROJECT_SCHEMA.length);
  const write = (value: string) =>
    db.run(
      `INSERT INTO latest_state (device_id, variable, value, received_at) VALUES ('', 'temp', ?, 1)
       ON CONFLICT(device_id, variable) DO UPDATE SET value = excluded.value`,
      value
    );
  write('21');
  write('22');
  expect(db.query(`SELECT value FROM latest_state`).all()).toEqual([{ value: '22' }]);
});

test('two devices keep separate state for the same variable', () => {
  const db = new Database(':memory:');
  applySteps(db, 0, PROJECT_SCHEMA.length);
  db.run(`INSERT INTO latest_state (device_id, variable, value, received_at) VALUES ('', 'temp', '21', 1)`);
  db.run(`INSERT INTO latest_state (device_id, variable, value, received_at) VALUES ('dev_b', 'temp', '30', 1)`);
  expect(db.query(`SELECT COUNT(*) AS n FROM latest_state WHERE variable = 'temp'`).get()).toEqual({ n: 2 });
});
