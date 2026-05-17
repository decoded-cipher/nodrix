// Better Auth Vue client. Uses cookies set by the worker, so no token plumbing
// is needed at call sites. Vite dev proxies /v1/auth/* to the worker.
import { createAuthClient } from 'better-auth/vue';

export const authClient = createAuthClient({
  baseURL: typeof location !== 'undefined' ? location.origin : 'http://localhost:8787',
  basePath: '/v1/auth',
});

export type AuthClient = typeof authClient;
