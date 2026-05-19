// Thin Cloudflare API client. Used by the Update / onboarding flow:
//
//   - validateToken: pings GET /accounts to confirm the pasted token works
//     and to extract the user's account_id without asking them to type it.
//   - triggerBuild: kicks off a Workers Builds rebuild for the running
//     Worker so it pulls the latest upstream code via the [build] script.
//   - getBuild:     polls a single build for status.
//
// Endpoint shapes for Workers Builds aren't fully nailed down in public
// docs yet — the dashboard uses them but the canonical API path can shift.
// Treat triggerBuild's URL as the place to adjust if Cloudflare changes it;
// the surrounding architecture (token storage, polling, UI) is unaffected.

const API_BASE = 'https://api.cloudflare.com/client/v4';

export class CloudflareApiError extends Error {
  constructor(public status: number, public errors: unknown) {
    super(`Cloudflare API error ${status}`);
  }
}

type CFResponse<T> = {
  success: boolean;
  errors: Array<{ code: number; message: string }>;
  messages: Array<{ code: number; message: string }>;
  result: T;
};

async function call<T>(
  token: string,
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'nodrix-worker',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = (await res.json().catch(() => null)) as CFResponse<T> | null;
  if (!res.ok || !payload?.success) {
    throw new CloudflareApiError(res.status, payload?.errors ?? []);
  }
  return payload.result;
}

// Used at onboarding time to confirm the pasted token works AND extract
// the account_id we'll need later. Tokens scoped to a single account
// return one entry; tokens scoped wider return many (we take the first
// and surface the rest in the UI for the user to confirm).
export async function validateToken(token: string): Promise<{ account_id: string; account_name: string; all: Array<{ id: string; name: string }> }> {
  const accounts = await call<Array<{ id: string; name: string }>>(token, 'GET', '/accounts');
  if (accounts.length === 0) {
    throw new CloudflareApiError(400, [{ code: 0, message: 'Token has no account access' }]);
  }
  return {
    account_id: accounts[0]!.id,
    account_name: accounts[0]!.name,
    all: accounts,
  };
}

// Triggers a Workers Builds run for the given script. The build pulls the
// latest upstream nodrix code (per scripts/build-from-upstream.sh) and
// redeploys. Returns a build identifier the UI can poll.
//
// NOTE: the exact endpoint for "force a Workers Build to run again" isn't
// stable across the dashboard / API. If the call below returns 404, the
// fallback path is: deep-link the owner to the dashboard's Builds tab so
// they can click "Trigger Build" manually. The Settings UI surfaces both.
export async function triggerBuild(
  token: string,
  accountId: string,
  scriptName: string
): Promise<{ build_id: string }> {
  const result = await call<{ id: string }>(
    token,
    'POST',
    `/accounts/${encodeURIComponent(accountId)}/workers/services/${encodeURIComponent(scriptName)}/builds`,
    {}
  );
  return { build_id: result.id };
}

export async function getBuild(
  token: string,
  accountId: string,
  scriptName: string,
  buildId: string
): Promise<{ id: string; status: 'queued' | 'running' | 'success' | 'failure' | 'unknown'; logs_url?: string }> {
  const result = await call<{ id: string; status: string; logs_url?: string }>(
    token,
    'GET',
    `/accounts/${encodeURIComponent(accountId)}/workers/services/${encodeURIComponent(scriptName)}/builds/${encodeURIComponent(buildId)}`
  );
  const status = ['queued', 'running', 'success', 'failure'].includes(result.status)
    ? (result.status as 'queued' | 'running' | 'success' | 'failure')
    : ('unknown' as const);
  return { id: result.id, status, logs_url: result.logs_url };
}
