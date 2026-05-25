// Unauthenticated fetch for the public share/embed viewer. Unlike api.ts there
// are no cookies, no 401 redirect handling, and no global progress bar — the
// share token in the URL is the only credential, and a failure just renders the
// "unavailable" state.

// Carries the HTTP status so callers can distinguish "link is gone" (404 — wrong
// token or sharing turned off) from a transient network/server failure (retry).
export class PublicApiError extends Error {
  constructor(public status: number) {
    super(`HTTP ${status}`);
    this.name = 'PublicApiError';
  }
}

export const publicApi = {
  async get<T>(path: string): Promise<T> {
    const res = await fetch(path, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new PublicApiError(res.status);
    return (await res.json()) as T;
  },
};
