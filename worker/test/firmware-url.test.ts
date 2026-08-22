// The only thing standing between this proxy and an open one.
// Run with `bun test worker/test/firmware-url.test.ts`.

import { test, expect } from 'bun:test';
import { binaryUrl } from '../src/domains/firmware/service';

test('builds a release asset URL from valid parts', () => {
  expect(binaryUrl('v1.2.0', 'LedControl-esp32.bin'))
    .toBe('https://github.com/decoded-cipher/nodrix-sdk/releases/download/v1.2.0/LedControl-esp32.bin');
});

test('refuses anything that is not a .bin', () => {
  expect(binaryUrl('v1', 'LedControl-esp32.exe')).toBeNull();
  expect(binaryUrl('v1', 'LedControl-esp32')).toBeNull();
});

test('refuses path traversal', () => {
  expect(binaryUrl('..', 'a.bin')).toBeNull();
  expect(binaryUrl('v1..2', 'a.bin')).toBeNull();
  expect(binaryUrl('v1', '..a.bin')).toBeNull();
  expect(binaryUrl('v1/../..', 'a.bin')).toBeNull();
});

test('refuses a host of the caller choosing', () => {
  expect(binaryUrl('https://evil.example', 'a.bin')).toBeNull();
  expect(binaryUrl('v1', 'https://evil.example/a.bin')).toBeNull();
  expect(binaryUrl('v1@evil.example', 'a.bin')).toBeNull();
});

test('refuses encoded and control characters', () => {
  expect(binaryUrl('%2e%2e', 'a.bin')).toBeNull();
  expect(binaryUrl('v1\nHost: evil', 'a.bin')).toBeNull();
  expect(binaryUrl('v1', 'a b.bin')).toBeNull();
});

test('refuses oversized parts', () => {
  expect(binaryUrl('v'.repeat(65), 'a.bin')).toBeNull();
  expect(binaryUrl('v1', `${'a'.repeat(129)}.bin`)).toBeNull();
});
