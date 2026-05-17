// Thin fetch wrapper. Sends CF Access JWT automatically via cookies in prod;
// in dev (no CF Access), uses the X-Dev-Email header from localStorage.

const DEV_EMAIL_KEY = 'nodrix:dev-email';

export function getDevEmail(): string | null {
  return localStorage.getItem(DEV_EMAIL_KEY);
}

export function setDevEmail(email: string): void {
  localStorage.setItem(DEV_EMAIL_KEY, email);
}

export function clearDevEmail(): void {
  localStorage.removeItem(DEV_EMAIL_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`HTTP ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  const dev = getDevEmail();
  if (dev) headers['x-dev-email'] = dev;

  const res = await fetch(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'include',
  });

  if (res.status === 204) return undefined as T;
  const payload = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, payload);
  return payload as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body),
  put: <T>(path: string, body?: unknown) => request<T>('PUT', path, body),
  patch: <T>(path: string, body?: unknown) => request<T>('PATCH', path, body),
  del: <T>(path: string) => request<T>('DELETE', path),
};
