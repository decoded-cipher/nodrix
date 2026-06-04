// Anonymous usage stats (product analytics) — separate from the device-data
// ingress in `domains/telemetry`. Always on and anonymous: the payload is a
// random instance id, version/commit, configured integration kinds, exact
// counts, and boolean flags — never an IP, hostname, name, or any value.
// Best-effort: failures are swallowed so a down collector can't affect the app.
//
//   sendInstall   — once, when the instance is set up (owner account created):
//                   mints the instance id and creates the collector row.
//   sendHeartbeat — daily cron: refreshes version/counts/last_seen.

import type { Env } from '../../env';
import { getSetting, setSetting } from './deployment-settings';
import { nanoid } from 'nanoid';
import { VERSION, COMMIT } from '../../version.gen';
import { VALID_KINDS } from '@nodrix/integrations-shared';
import { MCP_ENABLED_KEY } from '../../mcp/flags';

const INSTANCE_ID_KEY = 'usage.instance_id';
const DEFAULT_ENDPOINT = 'https://telemetry.nodrix.live/ingest';

type Event = 'install' | 'heartbeat';

interface Payload {
  event: Event;
  instance_id: string;
  version: string;
  commit_sha: string;
  kinds: string[];
  counts: Record<string, number>;
  flags: Record<string, boolean>;
}

// Random, persisted once at install — not derived from anything (a derived id
// would be re-identifiable).
async function getOrCreateInstanceId(env: Env): Promise<string> {
  const existing = await getSetting(env, INSTANCE_ID_KEY);
  if (existing) return existing;
  const id = nanoid();
  await setSetting(env, INSTANCE_ID_KEY, id);
  return id;
}

// A failed sub-query degrades that field rather than throwing.
async function buildPayload(env: Env, instanceId: string, event: Event): Promise<Payload> {
  const counts: Record<string, number> = {};
  try {
    const row = await env.DB.prepare(
      `SELECT
         (SELECT COUNT(*) FROM projects)          AS projects,
         (SELECT COUNT(*) FROM project_variables) AS variables,
         (SELECT COUNT(*) FROM dashboards)        AS dashboards,
         (SELECT COUNT(*) FROM automations)       AS automations,
         (SELECT COUNT(*) FROM integrations)      AS integrations,
         (SELECT COUNT(*) FROM users)             AS users`,
    ).first<Record<string, number>>();
    if (row) for (const [k, v] of Object.entries(row)) counts[k] = Number(v) || 0;
  } catch { /* leave counts partial */ }

  let kinds: string[] = [];
  try {
    const { results } = await env.DB.prepare(`SELECT DISTINCT kind FROM integrations`).all<{ kind: string }>();
    kinds = results.map((r) => r.kind).filter((k) => VALID_KINDS.has(k as never));
  } catch { /* leave kinds empty */ }

  const flags: Record<string, boolean> = { oauth_google: false, oauth_github: false, mcp: false };
  try {
    const { results } = await env.DB.prepare(`SELECT kind FROM auth_providers WHERE enabled = 1`).all<{ kind: string }>();
    for (const r of results) {
      if (r.kind === 'google') flags.oauth_google = true;
      if (r.kind === 'github') flags.oauth_github = true;
    }
  } catch { /* leave provider flags false */ }
  try {
    flags.mcp = (await getSetting(env, MCP_ENABLED_KEY)) === '1';
  } catch { /* leave mcp false */ }

  return { event, instance_id: instanceId, version: VERSION, commit_sha: COMMIT, kinds, counts, flags };
}

async function post(env: Env, payload: Payload): Promise<void> {
  const url = env.NODRIX_USAGE_STATS_URL?.trim() || DEFAULT_ENDPOINT;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch { /* a down/slow collector must never affect the app */ }
}

// Fired once at instance setup (owner-account creation): mint the id + create the row.
export function sendInstall(env: Env, ctx: ExecutionContext): void {
  ctx.waitUntil(
    (async () => {
      const id = await getOrCreateInstanceId(env);
      await post(env, await buildPayload(env, id, 'install'));
    })().catch(() => {}),
  );
}

// Daily cron: refresh the instance's details — version, counts, last_seen. If the instance id is missing, create it and send an install event.
export function sendHeartbeat(env: Env, ctx: ExecutionContext): void {
  ctx.waitUntil(
    (async () => {
      const existing = await getSetting(env, INSTANCE_ID_KEY);
      if (existing) {
        await post(env, await buildPayload(env, existing, 'heartbeat'));
        return;
      }
      const owner = await env.DB.prepare(`SELECT 1 AS one FROM users LIMIT 1`).first();
      if (!owner) return;
      const id = await getOrCreateInstanceId(env);
      await post(env, await buildPayload(env, id, 'install'));
    })().catch(() => {}),
  );
}
