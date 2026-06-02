// Shared fetch + crypto helpers used by the per-kind run handlers.

import type { IntegrationResult } from './index';

const TIMEOUT_MS = 10_000;

export async function doFetch(url: string, init: RequestInit): Promise<IntegrationResult> {
  const blocked = unsafeUrlReason(url);
  if (blocked) return { status: 'error', detail: blocked };
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? { status: 'ok', detail: String(res.status) } : { status: 'error', detail: `http ${res.status}` };
  } catch (e) {
    return { status: 'error', detail: (e as Error).message };
  }
}

// SSRF guard for user-supplied integration URLs. Workers egress can't reach
// RFC1918/loopback anyway, but the URLs are attacker-influenced (a project
// member configures them), so we refuse non-http(s) schemes and obviously
// internal hosts before any request leaves. Returns a reason when blocked.
export function unsafeUrlReason(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'invalid url';
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'unsupported url scheme';
  return isBlockedHost(u.hostname.toLowerCase().replace(/^\[|\]$/g, '')) ? 'url targets an internal host' : null;
}

function isBlockedHost(host: string): boolean {
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.internal') || host.endsWith('.local')) return true;

  const v4 = parseIpv4(host);
  if (v4) return isPrivateV4(v4);
  if (host.includes(':')) return isBlockedV6(host);
  return false;
}

function parseIpv4(host: string): [number, number, number, number] | null {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const out: number[] = [];
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const n = Number(p);
    if (n > 255) return null;
    out.push(n);
  }
  return out as [number, number, number, number];
}

// Loopback, private, link-local (incl. cloud metadata 169.254.169.254), CGNAT,
// unspecified, and broadcast ranges.
function isPrivateV4([a, b]: [number, number, number, number]): boolean {
  return (
    a === 0 || a === 10 || a === 127 || a === 255 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127)
  );
}

function isBlockedV6(host: string): boolean {
  if (host === '::' || host === '::1') return true;
  if (/^f[cd]/.test(host)) return true;        // fc00::/7 unique-local
  if (/^fe[89ab]/.test(host)) return true;     // fe80::/10 link-local
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i); // IPv4-mapped
  if (mapped) {
    const v4 = parseIpv4(mapped[1]!);
    return v4 ? isPrivateV4(v4) : true;
  }
  return false;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

export function strRecord(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === 'string') out[k] = val;
  }
  return out;
}
