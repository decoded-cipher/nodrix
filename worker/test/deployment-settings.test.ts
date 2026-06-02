// Domain 7 (settings): the deployment K/V cache that backs the security feature
// flags + signing secret — specifically the tombstone (cache "no value" so a
// missing key doesn't hammer D1) and cache-busting on write. Run with
// `bun test worker/test/deployment-settings.test.ts`.

import { test, expect } from 'bun:test';
import { getSetting, setSetting } from '../src/platform/lib/deployment-settings';

function fakeEnv() {
  const db = new Map<string, string>();
  const kv = new Map<string, string>();
  let dbReads = 0;
  const env: any = {
    DB: {
      prepare(sql: string) {
        const stmt: any = {
          _bound: [] as unknown[],
          bind(...args: unknown[]) { stmt._bound = args; return stmt; },
          async first() {
            if (/SELECT value/i.test(sql)) {
              dbReads++;
              const v = db.get(String(stmt._bound[0]));
              return v === undefined ? null : { value: v };
            }
            return null;
          },
          async run() {
            if (/^\s*DELETE/i.test(sql)) db.delete(String(stmt._bound[0]));
            else if (/INSERT/i.test(sql)) db.set(String(stmt._bound[0]), String(stmt._bound[1]));
            return { meta: { changes: 1 } };
          },
        };
        return stmt;
      },
    },
    KV: {
      async get(k: string) { return kv.has(k) ? kv.get(k)! : null; },
      async put(k: string, v: string) { kv.set(k, v); },
      async delete(k: string) { kv.delete(k); },
    },
  };
  return { env, dbReads: () => dbReads };
}

test('a missing key returns null and is tombstone-cached (no repeat D1 read)', async () => {
  const { env, dbReads } = fakeEnv();
  expect(await getSetting(env, 'mcp_enabled')).toBeNull();
  expect(await getSetting(env, 'mcp_enabled')).toBeNull();
  expect(dbReads()).toBe(1); // second read served from the tombstone cache
});

test('a set value is read back, and writes bust the cache', async () => {
  const { env } = fakeEnv();
  expect(await getSetting(env, 'audit_log_enabled')).toBeNull(); // caches tombstone
  await setSetting(env, 'audit_log_enabled', '1');               // busts the cache
  expect(await getSetting(env, 'audit_log_enabled')).toBe('1');
  await setSetting(env, 'audit_log_enabled', null);             // delete + bust
  expect(await getSetting(env, 'audit_log_enabled')).toBeNull();
});
