// Domain 4 (telemetry): the untrusted-input parser/validator — accepted shapes,
// the per-request caps, and key/value bounds. Pure logic. Run with
// `bun test worker/test/telemetry-validate.test.ts`.

import { test, expect } from 'bun:test';
import {
  parseTelemetryBody,
  validKey,
  validValue,
  MAX_POINTS,
  MAX_KEY_LEN,
  MAX_STRING_VALUE,
} from '../src/domains/telemetry/validate';

test('accepts the { metrics } batch shape', () => {
  const r = parseTelemetryBody({ metrics: { temp: 22.5, on: true, label: 'x', empty: null } });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.points).toHaveLength(4);
});

test('accepts the single { metric, value } shape', () => {
  const r = parseTelemetryBody({ metric: 'temp', value: 21 });
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.points).toEqual([{ variable: 'temp', value: 21 }]);
});

test('rejects non-object bodies and empty batches', () => {
  expect(parseTelemetryBody(null)).toMatchObject({ ok: false, error: { code: 'invalid_body' } });
  expect(parseTelemetryBody('nope')).toMatchObject({ ok: false, error: { code: 'invalid_body' } });
  expect(parseTelemetryBody({})).toMatchObject({ ok: false, error: { code: 'no_metrics' } });
  expect(parseTelemetryBody({ metrics: {} })).toMatchObject({ ok: false, error: { code: 'no_metrics' } });
});

test('rejects batches over the point cap', () => {
  const metrics: Record<string, number> = {};
  for (let i = 0; i <= MAX_POINTS; i++) metrics[`k${i}`] = i;
  expect(parseTelemetryBody({ metrics })).toMatchObject({ ok: false, error: { code: 'too_many_metrics' } });
});

test('rejects bad keys and surfaces bad-value keys', () => {
  expect(parseTelemetryBody({ metrics: { ['x'.repeat(MAX_KEY_LEN + 1)]: 1 } }))
    .toMatchObject({ ok: false, error: { code: 'invalid_key' } });
  expect(parseTelemetryBody({ metrics: { ['bad' + String.fromCharCode(0) + 'key']: 1 } }))
    .toMatchObject({ ok: false, error: { code: 'invalid_key' } });
  expect(parseTelemetryBody({ metrics: { temp: { nested: 1 } } }))
    .toMatchObject({ ok: false, error: { code: 'invalid_value', key: 'temp' } });
  expect(parseTelemetryBody({ metrics: { temp: Number.NaN } }))
    .toMatchObject({ ok: false, error: { code: 'invalid_value', key: 'temp' } });
});

test('validKey / validValue bounds', () => {
  expect(validKey('a')).toBe(true);
  expect(validKey('')).toBe(false);
  expect(validKey('x'.repeat(MAX_KEY_LEN))).toBe(true);
  expect(validKey('x'.repeat(MAX_KEY_LEN + 1))).toBe(false);

  expect(validValue(null)).toBe(true);
  expect(validValue(true)).toBe(true);
  expect(validValue(3.14)).toBe(true);
  expect(validValue(Number.POSITIVE_INFINITY)).toBe(false);
  expect(validValue('x'.repeat(MAX_STRING_VALUE))).toBe(true);
  expect(validValue('x'.repeat(MAX_STRING_VALUE + 1))).toBe(false);
  expect(validValue({})).toBe(false);
});
