// Shared fetch + crypto helpers used by the per-kind run handlers.

import type { IntegrationResult } from './index';

const TIMEOUT_MS = 10_000;

export async function doFetch(url: string, init: RequestInit): Promise<IntegrationResult> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return res.ok ? { status: 'ok', detail: String(res.status) } : { status: 'error', detail: `http ${res.status}` };
  } catch (e) {
    return { status: 'error', detail: (e as Error).message };
  }
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
