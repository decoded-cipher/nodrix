// Cache API wrapper for the read API's /state endpoint.
//
// Why this exists (plan §7.2 / invariant #5): without an edge cache, every
// /state read funnels through the Device DO that's also ingesting telemetry —
// the DO is single-threaded, so one chatty client can starve ingest. A 1s
// edge cache is enough to absorb realistic polling without sacrificing
// freshness for a dashboard.

const DEFAULT_TTL_SECONDS = 1;

export async function withEdgeCache(
  request: Request,
  produce: () => Promise<Response>,
  ttlSeconds: number = DEFAULT_TTL_SECONDS
): Promise<Response> {
  if (request.method !== 'GET') return produce();

  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
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
