// Version & updates endpoint.
//
// Returns the deployment's identity (baked at build time) alongside the
// upstream repo's latest main-branch commit, so the Settings UI can render a
// "you're behind, sync your fork" prompt.
//
// We cache the upstream lookup in KV with a 1h TTL. GitHub's unauthenticated
// API limit is 60 req/hour per IP, and Workers share edge IPs; aggressive
// caching is the simplest way to stay comfortably under it.

import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';
import { VERSION, COMMIT, BUILT_AT } from '../version.gen';

const version = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

version.use('*', requireSession);

const DEFAULT_UPSTREAM = 'decoded-cipher/nodrix';
const UPSTREAM_TTL_SECONDS = 3600;

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
};

async function fetchUpstreamCommit(repo: string): Promise<UpstreamCommit> {
  // GitHub API requires a User-Agent header. Worker fetch sets a default but
  // it's friendlier to identify ourselves so anyone tracing the request can
  // tell what's making it.
  const res = await fetch(`https://api.github.com/repos/${repo}/commits/master`, {
    headers: {
      'User-Agent': 'nodrix-update-check',
      Accept: 'application/vnd.github+json',
    },
  });
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
    sha: body.sha,
    short_sha: body.sha.slice(0, 7),
    // First line of the commit message — keep payload small.
    message: (body.commit.message ?? '').split('\n')[0]?.slice(0, 200) ?? '',
    author_date: authorDate,
    html_url: body.html_url,
  };
}

async function getCachedUpstream(env: Env, repo: string): Promise<CachedPayload | null> {
  const key = `version:upstream:${repo}`;
  try {
    const cached = await env.KV.get<CachedPayload>(key, 'json');
    if (cached) return cached;
  } catch { /* KV miss/error falls through to network */ }

  let commit: UpstreamCommit;
  try {
    commit = await fetchUpstreamCommit(repo);
  } catch {
    return null;
  }
  const payload: CachedPayload = { fetched_at: Math.floor(Date.now() / 1000), commit };
  try {
    await env.KV.put(key, JSON.stringify(payload), { expirationTtl: UPSTREAM_TTL_SECONDS });
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
  });
});

export default version;
