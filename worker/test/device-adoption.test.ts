// Run with `bun test worker/test/device-adoption.test.ts`.

import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { MIGRATIONS } from '../src/platform/db/migrations.gen';
import { forgetDevice, resolveDevice, useAsMainBoard } from '../src/domains/devices/service';
import type { Env } from '../src/env';

function d1(db: Database) {
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => statement(sql, a),
    first: async () => db.query(sql).get(...(args as never[])) ?? null,
    all: async () => ({ results: db.query(sql).all(...(args as never[])) }),
    run: async () => ({ meta: { changes: db.query(sql).run(...(args as never[])).changes } }),
  });
  return {
    prepare: (sql: string) => statement(sql),
    batch: async (stmts: { run: () => Promise<unknown> }[]) => {
      for (const s of stmts) await s.run();
    },
  };
}

function setup(projectId: string) {
  const db = new Database(':memory:');
  for (const m of MIGRATIONS) for (const stmt of m.statements) db.run(stmt);
  db.run(`INSERT INTO users (id, email, name, role, created_at, updated_at) VALUES ('usr_1', 'a@b.c', 'A', 'owner', 1, 1)`);
  db.run(`INSERT INTO projects (id, name, created_by, created_at, updated_at) VALUES (?, 'P', 'usr_1', 1, 1)`, [projectId]);
  db.run(`INSERT INTO devices (id, project_id, name, is_default, created_at) VALUES (?, ?, 'Default', 1, 1)`, [`dev_${projectId}`, projectId]);
  const deleted: string[] = [];
  const env = {
    DB: d1(db),
    PROJECT_DO: {
      idFromName: (n: string) => n,
      get: () => ({ deleteDevice: async (id: string) => void deleted.push(id) }),
    },
  } as unknown as Env;
  const rows = () => db.query(`SELECT id, device_key, name, is_default FROM devices ORDER BY created_at, id`).all();
  return { db, env, rows, deleted, defaultId: `dev_${projectId}` };
}

test('the first board takes over the default device', async () => {
  const { env, rows, defaultId } = setup('prj_first');
  const d = await resolveDevice(env, 'prj_first', 'AAA', 10);
  expect(d).toEqual({ id: defaultId, storageId: '', keyed: true });
  expect(rows()).toEqual([{ id: defaultId, device_key: 'AAA', name: 'AAA', is_default: 1 }]);
});

test('a cache hit keeps the default device on the empty storage id', async () => {
  const { env } = setup('prj_cache');
  await resolveDevice(env, 'prj_cache', 'AAA', 10);
  const again = await resolveDevice(env, 'prj_cache', 'AAA', 11);
  expect(again?.storageId).toBe('');
});

test('a second board gets its own device', async () => {
  const { env, rows } = setup('prj_second');
  await resolveDevice(env, 'prj_second', 'AAA', 10);
  const b = await resolveDevice(env, 'prj_second', 'BBB', 11);
  expect(b?.storageId).toBe(b!.id);
  expect(b?.keyed).toBe(true);
  expect(rows()).toHaveLength(2);
});

test('keyless requests land on the default device, unkeyed', async () => {
  const { env, defaultId } = setup('prj_keyless');
  await resolveDevice(env, 'prj_keyless', 'AAA', 10);
  expect(await resolveDevice(env, 'prj_keyless', null, 11)).toEqual({ id: defaultId, storageId: '', keyed: false });
});

test('an existing board blocks a later board from claiming an empty default', async () => {
  const { env, db, rows } = setup('prj_existing');
  db.run(`INSERT INTO devices (id, project_id, name, device_key, created_at) VALUES ('dev_old', 'prj_existing', 'old', 'OLD', 2)`);
  const c = await resolveDevice(env, 'prj_existing', 'CCC', 10);
  expect(c?.storageId).not.toBe('');
  expect(rows().find((r: any) => r.is_default)).toMatchObject({ device_key: null, name: 'Default' });
});

test('forgetting the default resets it for the next board', async () => {
  const { env, db, rows, deleted, defaultId } = setup('prj_forget');
  await resolveDevice(env, 'prj_forget', 'AAA', 10);
  db.run(`INSERT INTO project_variables (id, project_id, device_id, key, created_at, updated_at) VALUES ('var_1', 'prj_forget', ?, 'temp', 1, 1)`, [defaultId]);
  await forgetDevice(env, 'prj_forget', defaultId);
  expect(rows()).toEqual([{ id: defaultId, device_key: null, name: 'Default', is_default: 1 }]);
  expect(db.query(`SELECT COUNT(*) AS n FROM project_variables`).get()).toEqual({ n: 0 });
  expect(deleted).toEqual(['']);
  expect((await resolveDevice(env, 'prj_forget', 'ZZZ', 20))?.id).toBe(defaultId);
});

test('a replacement board takes over the default and drops its own row', async () => {
  const { env, rows, deleted, defaultId } = setup('prj_replace');
  await resolveDevice(env, 'prj_replace', 'AAA', 10);
  const b = await resolveDevice(env, 'prj_replace', 'BBB', 11);
  await useAsMainBoard(env, 'prj_replace', b!.id);
  expect(rows()).toEqual([{ id: defaultId, device_key: 'BBB', name: 'AAA', is_default: 1 }]);
  expect(deleted).toEqual([b!.id]);
  expect(await resolveDevice(env, 'prj_replace', 'BBB', 12)).toEqual({ id: defaultId, storageId: '', keyed: true });
});
