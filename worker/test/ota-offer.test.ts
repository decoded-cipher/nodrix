// Offering an update the board already applied is a reboot loop, not a retry.
// Run with `bun test worker/test/ota-offer.test.ts`.

import { test, expect } from 'bun:test';
import { offerFor } from '../src/domains/firmware/ota';
import type { Env } from '../src/env';

function envWith(row: Record<string, unknown> | null) {
  return {
    DB: {
      prepare: () => ({ bind: () => ({ first: () => Promise.resolve(row) }) }),
    },
  } as unknown as Env;
}

const desired = { version: '1.2.0', size: 100, sha256: 'abc', current: null };

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
