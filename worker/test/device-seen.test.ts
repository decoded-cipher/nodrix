// A throttle that never lets go is the same bug as no write at all.
// Run with `bun test worker/test/device-seen.test.ts`.

import { test, expect } from 'bun:test';
import { touchDevice } from '../src/domains/devices/service';
import type { Env } from '../src/env';

function fakeEnv(fail = false) {
  const writes: string[] = [];
  const env = {
    DB: {
      prepare() {
        return {
          bind(..._args: unknown[]) {
            return {
              run() {
                if (fail) throw new Error('d1 down');
                writes.push('write');
                return Promise.resolve();
              },
            };
          },
        };
      },
    },
  } as unknown as Env;
  return { env, writes };
}

test('writes once and then throttles the same device', async () => {
  const { env, writes } = fakeEnv();
  await touchDevice(env, 'dev_throttle_a');
  await touchDevice(env, 'dev_throttle_a');
  await touchDevice(env, 'dev_throttle_a');
  expect(writes.length).toBe(1);
});

test('throttles per device, not globally', async () => {
  const { env, writes } = fakeEnv();
  await touchDevice(env, 'dev_throttle_b');
  await touchDevice(env, 'dev_throttle_c');
  expect(writes.length).toBe(2);
});

test('a failed write retries on the next call', async () => {
  const failing = fakeEnv(true);
  await touchDevice(failing.env, 'dev_throttle_d');
  const ok = fakeEnv();
  await touchDevice(ok.env, 'dev_throttle_d');
  expect(ok.writes.length).toBe(1);
});
