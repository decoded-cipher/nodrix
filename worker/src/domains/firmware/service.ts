import type { Env } from '../../env';

// Prebuilt example binaries are published as release assets on the SDK repo.
const SDK_REPO = 'decoded-cipher/nodrix-sdk';
const CACHE_KEY = `firmware:catalog:${SDK_REPO}`;
const FRESH_SECONDS = 15 * 60;

// Assets are named <Example>-<target>.bin by the SDK's compile workflow.
const ASSET_NAME = /^([A-Za-z0-9_]+)-([A-Za-z0-9_]+)\.bin$/;

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
