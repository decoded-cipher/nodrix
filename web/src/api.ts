// Thin fetch wrapper. Auth is handled via session cookies set by Better Auth
// (worker mounted at /v1/auth/*). Cookies travel automatically thanks to
// credentials: 'include'. A 401 from any admin endpoint means the session
// is gone — the app subscribes via onUnauthorized() to redirect to /login.

import { progress } from './lib/progress';

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    // Use the real server-provided message so `error.message` is meaningful at
    // call sites (the JSON body is { error, reason, message? }); fall back to the
    // status when the response carried no body.
    super(ApiError.messageFrom(status, body));
  }

  private static messageFrom(status: number, body: unknown): string {
    const b = body as { error?: string; reason?: string; message?: string } | null;
    return b?.message || b?.reason || b?.error || `HTTP ${status}`;
  }
}

type UnauthorizedHandler = () => void;
let unauthorizedHandler: UnauthorizedHandler | null = null;

export function onUnauthorized(fn: UnauthorizedHandler) {
  unauthorizedHandler = fn;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  progress.start();
  try {
    const res = await fetch(path, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
    });

    if (res.status === 401) unauthorizedHandler?.();
    if (res.status === 204) return undefined as T;

    const payload = await res.json().catch(() => null);
    if (!res.ok) throw new ApiError(res.status, payload);
    return payload as T;
  } finally {
    progress.done();
  }
}

// Collapse concurrent identical GETs into one network request — e.g. two
// components mounting at once both calling the same loader. The promise is shared
// while in flight and dropped as soon as it settles, so this is a dedup of
// in-flight requests, not a response cache (data stays fresh on the next call).
const inflightGets = new Map<string, Promise<unknown>>();

function getDeduped<T>(path: string): Promise<T> {
  const existing = inflightGets.get(path);
  if (existing) return existing as Promise<T>;
  const p = request<T>('GET', path).finally(() => inflightGets.delete(path));
  inflightGets.set(path, p);
  return p;
}

export const api = {
  get: <T>(path: string) => getDeduped<T>(path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
