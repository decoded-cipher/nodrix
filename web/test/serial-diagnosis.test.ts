// The console's plain-language read of SDK debug output. Run with
// `bun test web/test/serial-diagnosis.test.ts`.

import { test, expect } from 'bun:test';
import { diagnose } from '../src/composables/useSerialDiagnosis';
import type { LogEntry } from '../src/composables/useSerialLog';

let id = 0;
function nodrix(text: string): LogEntry {
  return { id: ++id, at: 0, source: 'device', text, level: 'info', tag: 'nodrix' };
}
function sketch(text: string): LogEntry {
  return { id: ++id, at: 0, source: 'device', text, level: 'info' };
}

test('says nothing until the SDK says something', () => {
  expect(diagnose([])).toBeNull();
  expect(diagnose([sketch('Booting...'), sketch('temp=21.5')])).toBeNull();
});

test('names a missing Wi-Fi config', () => {
  const d = diagnose([nodrix('no wifi network set (call addAP)')]);
  expect(d?.tone).toBe('error');
  expect(d?.headline).toBe('No Wi-Fi network configured');
});

test('reads a 401 as a rejected token', () => {
  const d = diagnose([nodrix('POST /v1/telemetry -> 401 (token rejected)')]);
  expect(d?.tone).toBe('error');
  expect(d?.headline).toBe('Token rejected');
});

test('separates a refused handshake from a dropped link', () => {
  expect(diagnose([nodrix('connect refused - check token and host')])?.headline)
    .toBe('The server refused the connection');
  expect(diagnose([nodrix('connected'), nodrix('disconnected')])?.headline)
    .toBe('Disconnected');
});

test('qualifies a failure with Wi-Fi being up', () => {
  const d = diagnose([
    nodrix('wifi connected: 192.168.1.42'),
    nodrix('POST /v1/telemetry -> -1 (no connection - check host, DNS or TLS)'),
  ]);
  expect(d?.headline).toBe("Can't reach the server");
  expect(d?.detail).toStartWith('Wi-Fi is up.');
});

test('does not qualify a success with Wi-Fi noise', () => {
  const d = diagnose([nodrix('wifi connected: 192.168.1.42'), nodrix('connected')]);
  expect(d).toEqual({ tone: 'ok', headline: 'Connected' });
});

test('reports the most recent state, not the first', () => {
  const d = diagnose([
    nodrix('POST /v1/telemetry -> 401 (token rejected)'),
    nodrix('connected'),
  ]);
  expect(d?.headline).toBe('Connected');
});

test('carries the server code through', () => {
  const d = diagnose([nodrix('server error: variable_limit')]);
  expect(d?.detail).toBe('It replied with variable_limit.');
});

test('ignores sketch output that looks like SDK output', () => {
  expect(diagnose([sketch('connect refused - check token and host')])).toBeNull();
});
