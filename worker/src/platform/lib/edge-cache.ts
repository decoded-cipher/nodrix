// Cache API wrapper for the read API's /state endpoint.
//
// Without an edge cache, every /state read funnels through the Device DO that's
// also ingesting telemetry — the DO is single-threaded, so one chatty client
// can starve ingest. A 1s edge cache absorbs realistic polling without
// sacrificing freshness for a dashboard.

const DEFAULT_TTL_SECONDS = 1;

// The cache key keeps only the listed query params, so callers can't dodge the
// cache with junk params.
export async function withEdgeCache(
  request: Request,
  produce: () => Promise<Response>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
  keyParams: Record<string, string | number | undefined> = {}
): Promise<Response> {
  if (request.method !== 'GET') return produce();

  const cache = caches.default;
  const url = new URL(request.url);
  const keyUrl = new URL(url.origin + url.pathname);
  for (const [k, v] of Object.entries(keyParams)) if (v !== undefined) keyUrl.searchParams.set(k, String(v));
  const cacheKey = new Request(keyUrl.toString(), request);
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const fresh = await produce();
  if (fresh.ok) {
    const cacheable = new Response(fresh.clone().body, fresh);
    cacheable.headers.set('cache-control', `public, s-maxage=${ttlSeconds}`);
    // No await — Cache API put is fire-and-forget at the edge.
    cache.put(cacheKey, cacheable).catch(() => undefined);
  }
  return fresh;
}
