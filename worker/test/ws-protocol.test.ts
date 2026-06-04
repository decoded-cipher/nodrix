// Domain 4 (telemetry): the device->cloud WebSocket frame classifier. Pure logic —
// reuses parseTelemetryBody, so telemetry caps are covered in telemetry-validate.test.ts;
// here we assert the frame routing. Run with `bun test worker/test/ws-protocol.test.ts`.

import { test, expect } from 'bun:test';
import { parseDeviceMessage } from '../src/domains/telemetry/ws-protocol';
import { MAX_POINTS } from '../src/domains/telemetry/validate';

test('ack frame returns the string ids', () => {
  const m = parseDeviceMessage(JSON.stringify({ type: 'ack', ids: ['c1', 'c2'] }));
  expect(m).toEqual({ kind: 'ack', ids: ['c1', 'c2'] });
});

test('ack frame filters non-string ids', () => {
  const m = parseDeviceMessage(JSON.stringify({ type: 'ack', ids: ['c1', 3, null] }));
  expect(m).toEqual({ kind: 'ack', ids: ['c1'] });
});

test('telemetry { metrics } batch parses to points', () => {
  const m = parseDeviceMessage(JSON.stringify({ type: 'telemetry', metrics: { soil_moisture: 42, pump: 'off' } }));
  expect(m).toEqual({
    kind: 'telemetry',
    points: [
      { variable: 'soil_moisture', value: 42 },
      { variable: 'pump', value: 'off' },
    ],
  });
});

test('telemetry { metric, value } single parses to one point', () => {
  const m = parseDeviceMessage(JSON.stringify({ type: 'telemetry', metric: 'temp', value: 21.5 }));
  expect(m).toEqual({ kind: 'telemetry', points: [{ variable: 'temp', value: 21.5 }] });
});

test('telemetry with an invalid key is an error frame', () => {
  const longKey = 'k'.repeat(200);
  const m = parseDeviceMessage(JSON.stringify({ type: 'telemetry', metrics: { [longKey]: 1 } }));
  expect(m).toEqual({ kind: 'error', code: 'invalid_key' });
});

test('telemetry with an invalid value reports the offending key', () => {
  const m = parseDeviceMessage(JSON.stringify({ type: 'telemetry', metrics: { x: { nested: true } } }));
  expect(m).toEqual({ kind: 'error', code: 'invalid_value', key: 'x' });
});

test('telemetry over the per-frame cap is an error frame', () => {
  const metrics: Record<string, number> = {};
  for (let i = 0; i <= MAX_POINTS; i++) metrics[`k${i}`] = i;
  const m = parseDeviceMessage(JSON.stringify({ type: 'telemetry', metrics }));
  expect(m).toEqual({ kind: 'error', code: 'too_many_metrics' });
});

test('empty telemetry is an error frame', () => {
  const m = parseDeviceMessage(JSON.stringify({ type: 'telemetry', metrics: {} }));
  expect(m).toEqual({ kind: 'error', code: 'no_metrics' });
});

test('event frame parses event + payload', () => {
  const m = parseDeviceMessage(JSON.stringify({ type: 'event', event: 'watered', payload: { ml: 250 } }));
  expect(m).toEqual({ kind: 'event', event: 'watered', payload: { ml: 250 } });
});

test('event frame trims and drops a non-object payload', () => {
  const m = parseDeviceMessage(JSON.stringify({ type: 'event', event: '  watered  ', payload: 5 }));
  expect(m).toEqual({ kind: 'event', event: 'watered' });
});

test('event with no name is an error frame', () => {
  const m = parseDeviceMessage(JSON.stringify({ type: 'event', event: '   ' }));
  expect(m).toEqual({ kind: 'error', code: 'missing_event' });
});

test('unknown type is ignored', () => {
  expect(parseDeviceMessage(JSON.stringify({ type: 'hello' }))).toEqual({ kind: 'ignore' });
});

test('non-JSON is ignored', () => {
  expect(parseDeviceMessage('not json {')).toEqual({ kind: 'ignore' });
});

test('non-object JSON is ignored', () => {
  expect(parseDeviceMessage('5')).toEqual({ kind: 'ignore' });
  expect(parseDeviceMessage('null')).toEqual({ kind: 'ignore' });
});
