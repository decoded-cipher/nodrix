import type { Env } from '../../env';

// Prebuilt example binaries are published as release assets on the SDK repo.
const SDK_REPO = 'decoded-cipher/nodrix-sdk';
const CACHE_KEY = `firmware:catalog:${SDK_REPO}`;
const FRESH_SECONDS = 15 * 60;

// Assets are named <Example>-<target>.bin by the SDK's compile workflow.
const ASSET_NAME = /^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)\.bin$/;
// Anything reaching the download URL is built from these, so they decide whether
// this is a firmware proxy or an open one.
const SAFE_TAG = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_NAME = /^[A-Za-z0-9._-]{1,128}\.bin$/;

export type FirmwareEntry = { example: string; target: string; file: string; size: number };
export type FirmwareCatalog = { tag: string | null; entries: FirmwareEntry[] };

type Cached = FirmwareCatalog & { fetched_at: number; etag: string | null };

export async function getCatalog(env: Env): Promise<FirmwareCatalog> {
  const now = Math.floor(Date.now() / 1000);
  let cached: Cached | null = null;
  try {
    cached = await env.KV.get<Cached>(CACHE_KEY, 'json');
  } catch { /* KV miss → fetch */ }
  if (cached && now - cached.fetched_at < FRESH_SECONDS) {
    return { tag: cached.tag, entries: cached.entries };
  }

  const headers: Record<string, string> = {
    'User-Agent': 'nodrix-firmware-catalog',
    Accept: 'application/vnd.github+json',
  };
  if (cached?.etag) headers['If-None-Match'] = cached.etag;

  let res: Response;
  try {
    res = await fetch(`https://api.github.com/repos/${SDK_REPO}/releases/latest`, { headers });
  } catch {
    return cached ? { tag: cached.tag, entries: cached.entries } : { tag: null, entries: [] };
  }

  if (res.status === 304 && cached) {
    await put(env, { ...cached, fetched_at: now });
    return { tag: cached.tag, entries: cached.entries };
  }
  if (!res.ok) {
    // No release yet is a normal state, not an error worth surfacing.
    return cached ? { tag: cached.tag, entries: cached.entries } : { tag: null, entries: [] };
  }

  const body = (await res.json()) as {
    tag_name?: string;
    assets?: Array<{ name?: string; size?: number }>;
  };
  const entries: FirmwareEntry[] = [];
  for (const asset of body.assets ?? []) {
    const m = ASSET_NAME.exec(asset.name ?? '');
    if (!m) continue;
    entries.push({ example: m[1]!, target: m[2]!, file: asset.name!, size: asset.size ?? 0 });
  }
  const catalog: FirmwareCatalog = { tag: body.tag_name ?? null, entries };
  await put(env, { ...catalog, fetched_at: now, etag: res.headers.get('etag') });
  return catalog;
}

function put(env: Env, value: Cached): Promise<void> {
  return env.KV.put(CACHE_KEY, JSON.stringify(value)).catch(() => {});
}

// The client passes parts, never a URL. '..' is rejected separately because the
// charset allows dots, and ../ would climb out of the release path.
export function binaryUrl(tag: string, file: string): string | null {
  if (!SAFE_TAG.test(tag) || !SAFE_NAME.test(file)) return null;
  if (tag.includes('..') || file.includes('..')) return null;
  return `https://github.com/${SDK_REPO}/releases/download/${tag}/${file}`;
}

// Release assets carry no CORS headers, so the browser can't fetch one itself.
export async function fetchBinary(tag: string, file: string): Promise<Response | null> {
  const url = binaryUrl(tag, file);
  if (!url) return null;
  const res = await fetch(url, { headers: { 'User-Agent': 'nodrix-firmware-proxy' } });
  return res.ok ? res : null;
}
