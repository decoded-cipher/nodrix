// The two uploads that would otherwise reach a board: a file that isn't an app
// image, and the merged flash image Arduino writes next to it.
// Run with `bun test worker/test/firmware-image.test.ts`.

import { test, expect } from 'bun:test';
import { inspectImage } from '../src/domains/firmware/image';

function appImage(chipId: number, length = 4096): ArrayBuffer {
  const bytes = new Uint8Array(length);
  bytes[0] = 0xe9;
  bytes[12] = chipId & 0xff;
  bytes[13] = (chipId >> 8) & 0xff;
  return bytes.buffer;
}

test('reads the chip an ESP32 image was built for', () => {
  expect(inspectImage(appImage(0x0009))).toEqual({ ok: true, chip: 'esp32-s3' });
  expect(inspectImage(appImage(0x0000))).toEqual({ ok: true, chip: 'esp32' });
});

test('an unknown chip id is no chip, not a rejection', () => {
  expect(inspectImage(appImage(0x00ff))).toEqual({ ok: true, chip: null });
});

test('rejects a file that is not an ESP image', () => {
  const notEsp = new Uint8Array(4096);
  notEsp[0] = 0x7f;
  const r = inspectImage(notEsp.buffer);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe('not_an_esp_image');
});

test('rejects anything shorter than a header', () => {
  const r = inspectImage(new Uint8Array([0xe9, 0x01]).buffer);
  expect(r.ok).toBe(false);
});

test('rejects a merged flash image by its partition table', () => {
  const bytes = new Uint8Array(0x9000);
  bytes[0] = 0xe9;
  bytes[0x8000] = 0xaa;
  bytes[0x8001] = 0x50;
  const r = inspectImage(bytes.buffer);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.code).toBe('merged_image');
});

test('an app image larger than the partition offset still passes', () => {
  expect(inspectImage(appImage(0x0000, 0x9000))).toEqual({ ok: true, chip: 'esp32' });
});
