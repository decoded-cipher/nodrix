// Offering an update the board already applied is a reboot loop, not a retry.
// Run with `bun test worker/test/ota-offer.test.ts`.

import { test, expect } from 'bun:test';
import { chipFamily, isTerminal, offerFor } from '../src/domains/firmware/ota';
import type { Env } from '../src/env';

function envWith(row: Record<string, unknown> | null) {
  return {
    DB: {
      prepare: () => ({ bind: () => ({ first: () => Promise.resolve(row) }) }),
    },
  } as unknown as Env;
}

const desired = { version: '1.2.0', size: 100, sha256: 'abc', current: null, status: 'pending' };

test('offers when the board runs something else', async () => {
  const offer = await offerFor(envWith({ ...desired, current: '1.1.0' }), 'prj_a', 'dev_a');
  expect(offer?.version).toBe('1.2.0');
});

test('offers nothing once the stored version matches', async () => {
  const offer = await offerFor(envWith({ ...desired, current: '1.2.0' }), 'prj_a', 'dev_a');
  expect(offer).toBeNull();
});

test('a version reported in the request beats the stored one', async () => {
  const env = envWith({ ...desired, current: '1.1.0' });
  expect(await offerFor(env, 'prj_a', 'dev_a', '1.2.0')).toBeNull();
});

test('a stale stored version does not suppress a real update', async () => {
  const env = envWith({ ...desired, current: '1.2.0' });
  expect((await offerFor(env, 'prj_a', 'dev_a', '1.1.0'))?.version).toBe('1.2.0');
});

test('offers nothing with no desired firmware', async () => {
  expect(await offerFor(envWith(null), 'prj_a', 'dev_a')).toBeNull();
});

// A board that pulled the image and still reports the old version isn't retrying
// its way out of it; offering again is the reflash loop.
test('offers nothing once the update is marked failed', async () => {
  const env = envWith({ ...desired, current: '1.1.0', status: 'failed' });
  expect(await offerFor(env, 'prj_a', 'dev_a', '1.1.0')).toBeNull();
});

test('chip family folds classic esp32 variants and keeps the rest', () => {
  expect(chipFamily('esp32-d0wd-v3')).toBe('esp32');
  expect(chipFamily('esp32-pico-d4')).toBe('esp32');
  expect(chipFamily('ESP32-S3')).toBe('esp32-s3');
  expect(chipFamily('esp32-c3')).toBe('esp32-c3');
  expect(chipFamily('esp8266')).toBe('esp8266');
  expect(chipFamily(null)).toBeNull();
});

test('a rollback of the desired version is terminal', () => {
  expect(isTerminal({ state: 'rolled_back', version: '1.2.0' }, '1.2.0')).toBe(true);
  expect(isTerminal({ state: 'rolled_back', version: '1.1.0' }, '1.2.0')).toBe(false);
});

test('only image faults end an update; network failures retry', () => {
  expect(isTerminal({ state: 'failed', code: -100 }, '1.2.0')).toBe(true);
  expect(isTerminal({ state: 'failed', code: -105 }, '1.2.0')).toBe(true);
  expect(isTerminal({ state: 'failed', code: -104 }, '1.2.0')).toBe(false);
  expect(isTerminal({ state: 'failed', code: -1 }, '1.2.0')).toBe(false);
  expect(isTerminal({ state: 'failed' }, '1.2.0')).toBe(false);
});
