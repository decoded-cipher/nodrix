// Domain 3 (identity/authz): the project-access gate (resolveProject) and the
// credential rate limiter, driven through real Hono apps with stubbed bindings.
// Run with `bun test worker/test/authz.test.ts`.

import { test, expect } from 'bun:test';
import { Hono } from 'hono';
import { resolveProject } from '../src/platform/middleware/resolve-project';
import { authRateLimit } from '../src/platform/middleware/rate-limit';

// ── resolveProject ────────────────────────────────────────────────────────────

type ProjRow = { id: string; name: string; member: string | null } | null;

function projectCall(user: { id: string; role: string }, row: ProjRow) {
  const env: any = { DB: { prepare: () => ({ bind: () => ({ first: async () => row }) }) } };
  const app = new Hono<any>();
  app.use('*', async (c, next) => { c.set('user', user); await next(); });
  app.get('/:proj/thing', resolveProject, (c) => c.json({ project: c.get('project') }));
  return () => app.request('/p1/thing', {}, env);
}

test('member without a membership row is forbidden', async () => {
  const res = await projectCall({ id: 'u1', role: 'member' }, { id: 'p1', name: 'P', member: null })();
  expect(res.status).toBe(403);
});

test('member with a membership row is allowed', async () => {
  const res = await projectCall({ id: 'u1', role: 'member' }, { id: 'p1', name: 'P', member: 'u1' })();
  expect(res.status).toBe(200);
});

test('owner and admin reach any existing project', async () => {
  expect((await projectCall({ id: 'a', role: 'admin' }, { id: 'p1', name: 'P', member: null })()).status).toBe(200);
  expect((await projectCall({ id: 'o', role: 'owner' }, { id: 'p1', name: 'P', member: null })()).status).toBe(200);
});

test('missing project is 404 (before any access check)', async () => {
  const res = await projectCall({ id: 'u1', role: 'member' }, null)();
  expect(res.status).toBe(404);
});

// ── authRateLimit ─────────────────────────────────────────────────────────────

function rlApp() {
  const store = new Map<string, string>();
  const env: any = {
    KV: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
    },
  };
  const app = new Hono<any>();
  app.use('*', authRateLimit);
  app.post('/v1/auth/sign-in/email', (c) => c.json({ ok: true }));
  app.get('/v1/auth/get-session', (c) => c.json({ ok: true }));
  return { app, env };
}

test('credential POSTs are blocked past the per-window cap', async () => {
  const { app, env } = rlApp();
  const hit = () => app.request('/v1/auth/sign-in/email', { method: 'POST', headers: { 'cf-connecting-ip': '1.2.3.4' } }, env);
  for (let i = 0; i < 10; i++) expect((await hit()).status).toBe(200);
  expect((await hit()).status).toBe(429);
});

test('session reads are never throttled', async () => {
  const { app, env } = rlApp();
  for (let i = 0; i < 20; i++) {
    expect((await app.request('/v1/auth/get-session', {}, env)).status).toBe(200);
  }
});
