// Domain 1 (integrations) safety net: the SSRF guard on outbound URLs, the
// AES-GCM config sealing round-trip + cross-purpose key isolation, and that MCP
// redaction still masks secrets on the decrypted object. Pure logic — no env.
// Run with `bun test worker/test/integrations.test.ts`.

import { test, expect } from 'bun:test';
import { unsafeUrlReason } from '../../shared/integrations/lib';
import { encryptSecret, decryptSecret } from '../src/platform/lib/crypto';
import { redactConfig } from '../src/mcp/redact';

// ── SSRF guard ────────────────────────────────────────────────────────────────

test('unsafeUrlReason allows real connector endpoints', () => {
  expect(unsafeUrlReason('https://hooks.slack.com/services/T/B/x')).toBeNull();
  expect(unsafeUrlReason('https://api.telegram.org/botTOKEN/sendMessage')).toBeNull();
  expect(unsafeUrlReason('http://example.com/webhook')).toBeNull();
  expect(unsafeUrlReason('http://8.8.8.8/x')).toBeNull();        // public IP
  expect(unsafeUrlReason('http://11.0.0.1/x')).toBeNull();       // 11/8 is public
  expect(unsafeUrlReason('http://172.32.0.1/x')).toBeNull();     // outside 172.16/12
});

test('unsafeUrlReason blocks non-http(s) schemes and junk', () => {
  expect(unsafeUrlReason('file:///etc/passwd')).toBeTruthy();
  expect(unsafeUrlReason('ftp://example.com/x')).toBeTruthy();
  expect(unsafeUrlReason('gopher://example.com')).toBeTruthy();
  expect(unsafeUrlReason('not a url')).toBeTruthy();
});

test('unsafeUrlReason blocks internal hosts (loopback/private/link-local/metadata)', () => {
  for (const u of [
    'http://localhost/x',
    'http://app.localhost/x',
    'http://127.0.0.1/x',
    'http://0.0.0.0/x',
    'http://10.1.2.3/x',
    'http://172.16.0.1/x',
    'http://192.168.1.1/x',
    'http://169.254.169.254/latest/meta-data/', // cloud metadata
    'http://100.100.100.100/x',                  // CGNAT 100.64/10
    'http://service.internal/x',
    'http://printer.local/x',
    'http://[::1]/x',
    'http://[fd00::1]/x',
    'http://[fe80::1]/x',
  ]) {
    expect(unsafeUrlReason(u)).toBeTruthy();
  }
});

// ── config sealing (AES-GCM via crypto.ts) ────────────────────────────────────

test('integration config seals and opens losslessly, hiding the secret', async () => {
  const secret = 'deployment-signing-secret';
  const plaintext = JSON.stringify({ api_key: 'sk_live_123', webhook_url: 'https://x' });
  const sealed = await encryptSecret(secret, plaintext, 'integration-config');
  expect(sealed.startsWith('v1:')).toBe(true);
  expect(sealed).not.toContain('sk_live_123');
  expect(await decryptSecret(secret, sealed, 'integration-config')).toBe(plaintext);
});

test('sealed config cannot be opened with a different HKDF purpose', async () => {
  const sealed = await encryptSecret('s', 'top-secret', 'integration-config');
  let threw = false;
  try {
    await decryptSecret('s', sealed, 'oauth-client-secret');
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
});

// ── MCP redaction on the decrypted object ─────────────────────────────────────

test('redactConfig masks secret-like keys, keeps structure and benign fields', () => {
  const out = redactConfig({
    webhook_url: 'https://hooks/x',
    api_key: 'sk_1',
    from: 'a@b.com',
    nested: { auth_token: 't', label: 'ok' },
  }) as Record<string, any>;
  expect(out.api_key).toBe('***redacted***');
  expect(out.webhook_url).toBe('***redacted***');
  expect(out.from).toBe('a@b.com');
  expect(out.nested.auth_token).toBe('***redacted***');
  expect(out.nested.label).toBe('ok');
});
