// Version & updates endpoint. Reports the deployment's build-time identity and
// the upstream's latest reference so Settings can show an "update available"
// prompt. Which reference depends on the channel baked into version.gen.ts:
//   - release: the upstream's latest published GitHub release (compared by version).
//   - edge:    the upstream's default-branch HEAD (compared by commit SHA).
// The upstream lookup is cached in KV with a short freshness window and
// revalidated via conditional requests (If-None-Match) to stay under GitHub's
// 60 req/hour unauthenticated limit.

import { Hono } from 'hono';
import type { Env } from '../../env';
import { requireSession, type UserContextVars } from '../../platform/middleware/require-session';
import { VERSION, COMMIT, CHANNEL, BUILT_AT } from '../../version.gen';

const version = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

version.use('*', requireSession);

const DEFAULT_UPSTREAM = 'decoded-cipher/nodrix';
// Branch tracked on the edge channel (the project's default branch).
const DEFAULT_BRANCH = 'master';
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

// Strip a leading "v" so "v0.9.0" and "0.9.0" compare equal.
function stripV(s: string): string {
  return s.trim().replace(/^v/i, '');
}

// Normalized upstream reference, channel-agnostic.
//   - ref:       compare key — release tag ("v0.9.0") or full commit SHA.
//   - short_ref: display value — tag, or 7-char SHA.
//   - title:     release name, or commit message first line.
//   - ref_date:  unix seconds — release published_at, or commit author date.
type UpstreamRef = {
  ref: string;
  short_ref: string;
  title: string;
  ref_date: number | null;
  html_url: string;
};

type CachedPayload = {
  fetched_at: number;
  upstream: UpstreamRef;
  etag: string | null; // for conditional revalidation (If-None-Match)
};

type FetchResult =
  | { kind: 'not_modified' }
  | { kind: 'ok'; upstream: UpstreamRef; etag: string | null };

function mapRelease(body: {
  tag_name?: string;
  name?: string;
  published_at?: string;
  html_url?: string;
}): UpstreamRef {
  const tag = body.tag_name ?? '';
  return {
    ref: tag,
    short_ref: tag,
    title: (body.name || tag).slice(0, 200),
    ref_date: body.published_at ? Math.floor(new Date(body.published_at).getTime() / 1000) : null,
    html_url: body.html_url ?? '',
  };
}

function mapCommit(body: {
  sha: string;
  commit: { message: string; author?: { date?: string } };
  html_url: string;
}): UpstreamRef {
  const authorDate = body.commit.author?.date ? Math.floor(new Date(body.commit.author.date).getTime() / 1000) : null;
  return {
    ref: body.sha,
    short_ref: body.sha.slice(0, 7),
    // First line of the commit message — keep payload small.
    title: (body.commit.message ?? '').split('\n')[0]?.slice(0, 200) ?? '',
    ref_date: authorDate,
    html_url: body.html_url,
  };
}

async function fetchUpstream(repo: string, etag?: string | null): Promise<FetchResult> {
  // GitHub requires a User-Agent. If-None-Match makes GitHub answer 304 when
  // nothing changed since our last fetch.
  const headers: Record<string, string> = {
    'User-Agent': 'nodrix-update-check',
    Accept: 'application/vnd.github+json',
  };
  if (etag) headers['If-None-Match'] = etag;

  const url =
    CHANNEL === 'edge'
      ? `https://api.github.com/repos/${repo}/commits/${DEFAULT_BRANCH}`
      : `https://api.github.com/repos/${repo}/releases/latest`;

  const res = await fetch(url, { headers });
  if (res.status === 304) return { kind: 'not_modified' };
  if (!res.ok) {
    // No published release (404) on the release channel is an expected state for
    // a fresh upstream — surface it as "couldn't reach", not a hard error.
    throw new Error(`upstream fetch failed: ${res.status}`);
  }
  const body = (await res.json()) as never;
  const upstream = CHANNEL === 'edge' ? mapCommit(body) : mapRelease(body);
  return { kind: 'ok', etag: res.headers.get('etag'), upstream };
}

async function getCachedUpstream(env: Env, repo: string): Promise<CachedPayload | null> {
  // Channel in the key so switching channels never serves cross-channel data.
  const key = `version:upstream:${CHANNEL}:${repo}`;
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
    result = await fetchUpstream(repo, cached?.etag);
  } catch {
    // Network/API error: a stale ref beats dropping to "unknown".
    return cached;
  }

  if (result.kind === 'not_modified') {
    // Unchanged: re-stamp the cached ref as freshly checked.
    if (!cached) return null;
    const refreshed: CachedPayload = { ...cached, fetched_at: now };
    try {
      await env.KV.put(key, JSON.stringify(refreshed), { expirationTtl: UPSTREAM_KV_TTL_SECONDS });
    } catch { /* best-effort */ }
    return refreshed;
  }

  const payload: CachedPayload = { fetched_at: now, upstream: result.upstream, etag: result.etag };
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

  const cached = await getCachedUpstream(c.env, upstreamRepo);
  const upstream = cached?.upstream ?? null;

  // "up-to-date" requires both a known local identity AND a successful upstream
  // lookup; either failing → status "unknown".
  //   - release: compare the deployed version against the latest release tag.
  //   - edge:    compare the deployed commit SHA against the branch HEAD.
  let status: 'up_to_date' | 'behind' | 'unknown' = 'unknown';
  if (upstream) {
    if (CHANNEL === 'edge') {
      if (current.commit !== 'unknown') {
        status = upstream.ref === current.commit ? 'up_to_date' : 'behind';
      }
    } else {
      status = stripV(upstream.ref) === stripV(current.version) ? 'up_to_date' : 'behind';
    }
  }

  // Construct a github.com compare URL for the "see what changed" link. Only
  // meaningful when we know both ends of the comparison.
  let compare_url: string | null = null;
  if (status === 'behind' && upstream) {
    compare_url =
      CHANNEL === 'edge'
        ? `https://github.com/${upstreamRepo}/compare/${current.commit}...${upstream.ref}`
        : `https://github.com/${upstreamRepo}/compare/v${stripV(current.version)}...${upstream.ref}`;
  }

  const scriptName = scriptNameFromHost(new URL(c.req.url).host);
  const dashboard_url = buildDashboardUrl(scriptName);

  return c.json({
    channel: CHANNEL,
    current,
    upstream_repo: upstreamRepo,
    upstream: upstream
      ? {
          ref: upstream.short_ref,
          title: upstream.title,
          ref_date: upstream.ref_date,
          html_url: upstream.html_url,
          fetched_at: cached!.fetched_at,
        }
      : null,
    status,
    compare_url,
    dashboard_url,
    script_name: scriptName,
  });
});

export default version;
