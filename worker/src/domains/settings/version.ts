// Version & updates endpoint. Reports the deployment's build-time identity and
// the upstream repo's latest commit so Settings can show a "sync your fork"
// prompt. The upstream lookup is cached in KV with a short freshness window and
// revalidated via conditional requests (If-None-Match) to stay under GitHub's
// 60 req/hour unauthenticated limit.

import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession, type UserContextVars } from '../../platform/middleware/require-session';
import { VERSION, COMMIT, BUILT_AT } from '../../version.gen';

const version = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

version.use('*', requireSession);

const DEFAULT_UPSTREAM = 'decoded-cipher/nodrix';
// Cache is served as-is for FRESH seconds; the entry (with its ETag) is kept in
// KV for KV_TTL so revalidation can stay conditional across freshness windows.
const UPSTREAM_FRESH_SECONDS = 300;
const UPSTREAM_KV_TTL_SECONDS = 86400;

// Cloudflare's dashboard URL takes a `?to=/:account/...` path; CF substitutes
// the account selector at sign-in time, so we don't need to know the owner's
// account_id. If they have multiple accounts, CF prompts them to pick.
function buildDashboardUrl(scriptName: string): string {
  const path = `/:account/workers/services/view/${encodeURIComponent(scriptName)}/production/builds`;
  return `https://dash.cloudflare.com/?to=${encodeURIComponent(path)}`;
}

function scriptNameFromHost(host: string): string {
  if (host.endsWith('.workers.dev')) {
    const label = host.slice(0, host.indexOf('.'));
    if (label) return label;
  }
  return 'nodrix';
}

type UpstreamCommit = {
  sha: string;
  short_sha: string;
  message: string;
  author_date: number | null;
  html_url: string;
};

type CachedPayload = {
  fetched_at: number;
  commit: UpstreamCommit;
  etag: string | null; // for conditional revalidation (If-None-Match)
};

type FetchResult =
  | { kind: 'not_modified' }
  | { kind: 'ok'; commit: UpstreamCommit; etag: string | null };

async function fetchUpstreamCommit(repo: string, etag?: string | null): Promise<FetchResult> {
  // GitHub requires a User-Agent. If-None-Match makes GitHub answer 304 when
  // nothing changed since our last fetch.
  const headers: Record<string, string> = {
    'User-Agent': 'nodrix-update-check',
    Accept: 'application/vnd.github+json',
  };
  if (etag) headers['If-None-Match'] = etag;

  const res = await fetch(`https://api.github.com/repos/${repo}/commits/master`, { headers });
  if (res.status === 304) return { kind: 'not_modified' };
  if (!res.ok) {
    throw new Error(`upstream commit fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as {
    sha: string;
    commit: { message: string; author?: { date?: string } };
    html_url: string;
  };
  const authorDate = body.commit.author?.date ? Math.floor(new Date(body.commit.author.date).getTime() / 1000) : null;
  return {
    kind: 'ok',
    etag: res.headers.get('etag'),
    commit: {
      sha: body.sha,
      short_sha: body.sha.slice(0, 7),
      // First line of the commit message — keep payload small.
      message: (body.commit.message ?? '').split('\n')[0]?.slice(0, 200) ?? '',
      author_date: authorDate,
      html_url: body.html_url,
    },
  };
}

async function getCachedUpstream(env: Env, repo: string): Promise<CachedPayload | null> {
  const key = `version:upstream:${repo}`;
  const now = Math.floor(Date.now() / 1000);

  let cached: CachedPayload | null = null;
  try {
    cached = await env.KV.get<CachedPayload>(key, 'json');
  } catch { /* KV miss/error → treat as no cache */ }

  // Inside the freshness window: serve cache, no network.
  if (cached && now - cached.fetched_at < UPSTREAM_FRESH_SECONDS) {
    return cached;
  }

  // Stale or missing → revalidate, conditionally if we have an ETag.
  let result: FetchResult;
  try {
    result = await fetchUpstreamCommit(repo, cached?.etag);
  } catch {
    // Network/API error: a stale commit beats dropping to "unknown".
    return cached;
  }

  if (result.kind === 'not_modified') {
    // Unchanged: re-stamp the cached commit as freshly checked.
    if (!cached) return null;
    const refreshed: CachedPayload = { ...cached, fetched_at: now };
    try {
      await env.KV.put(key, JSON.stringify(refreshed), { expirationTtl: UPSTREAM_KV_TTL_SECONDS });
    } catch { /* best-effort */ }
    return refreshed;
  }

  const payload: CachedPayload = { fetched_at: now, commit: result.commit, etag: result.etag };
  try {
    await env.KV.put(key, JSON.stringify(payload), { expirationTtl: UPSTREAM_KV_TTL_SECONDS });
  } catch { /* best-effort */ }
  return payload;
}

// GET /v1/admin/version — current + upstream + compare URL.
// Owner OR admin (this is informational, not destructive).
version.get('/', async (c) => {
  const upstreamRepo = (c.env.NODRIX_UPSTREAM_REPO ?? DEFAULT_UPSTREAM).trim() || DEFAULT_UPSTREAM;

  const current = {
    version: VERSION,
    commit: COMMIT,
    short_commit: COMMIT === 'unknown' ? 'unknown' : COMMIT.slice(0, 7),
    built_at: BUILT_AT || null,
  };

  const upstream = await getCachedUpstream(c.env, upstreamRepo);

  // We compare commit SHAs — easier than walking history and survives forks
  // that rebase. "up-to-date" requires both a known local commit AND a
  // successful upstream lookup; either failing → status "unknown".
  let status: 'up_to_date' | 'behind' | 'unknown' = 'unknown';
  if (upstream && current.commit !== 'unknown') {
    status = current.commit === upstream.commit.sha ? 'up_to_date' : 'behind';
  }

  // Construct a github.com compare URL for the "see what changed" link. Only
  // meaningful when we know both ends of the comparison.
  const compare_url =
    status === 'behind'
      ? `https://github.com/${upstreamRepo}/compare/${current.commit}...${upstream!.commit.sha}`
      : null;

  const scriptName = scriptNameFromHost(new URL(c.req.url).host);
  const dashboard_url = buildDashboardUrl(scriptName);

  return c.json({
    current,
    upstream_repo: upstreamRepo,
    upstream: upstream
      ? {
          commit: upstream.commit,
          fetched_at: upstream.fetched_at,
        }
      : null,
    status,
    compare_url,
    dashboard_url,
    script_name: scriptName,
  });
});

export default version;
