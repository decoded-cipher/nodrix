import { Hono } from 'hono';
import type { Env } from '../env';
import { requireSession, type UserContextVars } from '../middleware/require-session';
import { recordAudit } from '../lib/audit';

const authProviders = new Hono<{ Bindings: Env; Variables: UserContextVars }>();

authProviders.use('*', requireSession);

const KINDS = ['google', 'github'] as const;
type Kind = (typeof KINDS)[number];

type Row = {
  kind: Kind;
  client_id: string;
  client_secret: string;
  enabled: number;
  created_at: number;
  updated_at: number;
};

function ownerOnly(role: string) {
  return role === 'owner';
}

// GET /v1/admin/auth-providers — list configured providers (owner-only).
// Returns clientId publicly but masks the secret.
authProviders.get('/', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);

  const rows = await c.env.DB
    .prepare(`SELECT kind, client_id, enabled, created_at, updated_at FROM auth_providers`)
    .all<Omit<Row, 'client_secret'>>();

  return c.json({
    providers: rows.results.map((r) => ({
      kind: r.kind,
      client_id: r.client_id,
      enabled: r.enabled === 1,
      created_at: r.created_at,
      updated_at: r.updated_at,
    })),
  });
});

// PUT /v1/admin/auth-providers/:kind  body: { client_id, client_secret, enabled? }
authProviders.put('/:kind', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);

  const kind = c.req.param('kind') as Kind;
  if (!KINDS.includes(kind)) return c.json({ error: 'bad_request', reason: 'unknown_provider' }, 400);

  const body = await c.req.json<{
    client_id?: string;
    client_secret?: string;
    enabled?: boolean;
  }>();
  const clientId = (body.client_id ?? '').trim();
  const clientSecret = (body.client_secret ?? '').trim();
  if (!clientId || !clientSecret) {
    return c.json({ error: 'bad_request', reason: 'missing_credentials' }, 400);
  }
  const enabled = body.enabled === false ? 0 : 1;
  const now = Math.floor(Date.now() / 1000);

  await c.env.DB
    .prepare(
      `INSERT INTO auth_providers (kind, client_id, client_secret, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(kind) DO UPDATE SET
         client_id = excluded.client_id,
         client_secret = excluded.client_secret,
         enabled = excluded.enabled,
         updated_at = excluded.updated_at`
    )
    .bind(kind, clientId, clientSecret, enabled, now, now)
    .run();

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'auth_provider.update',
      targetType: 'integration',
      targetId: kind,
      metadata: { enabled: enabled === 1 },
    })
  );

  return c.json({ kind, client_id: clientId, enabled: enabled === 1 });
});

// DELETE /v1/admin/auth-providers/:kind
authProviders.delete('/:kind', async (c) => {
  const user = c.get('user');
  if (!ownerOnly(user.role)) return c.json({ error: 'forbidden' }, 403);

  const kind = c.req.param('kind') as Kind;
  if (!KINDS.includes(kind)) return c.json({ error: 'bad_request', reason: 'unknown_provider' }, 400);

  const res = await c.env.DB
    .prepare(`DELETE FROM auth_providers WHERE kind = ?`)
    .bind(kind)
    .run();
  if (res.meta.changes === 0) return c.json({ error: 'not_found' }, 404);

  c.executionCtx.waitUntil(
    recordAudit(c.env, {
      projectId: null,
      userId: user.id,
      action: 'auth_provider.delete',
      targetType: 'integration',
      targetId: kind,
    })
  );

  return c.body(null, 204);
});

// Public: list of provider kinds enabled for sign-in. Used by the login page
// to render the right OAuth buttons. No middleware — anonymous callers OK.
export const publicAuthProviders = new Hono<{ Bindings: Env }>();
publicAuthProviders.get('/', async (c) => {
  try {
    const rows = await c.env.DB
      .prepare(`SELECT kind FROM auth_providers WHERE enabled = 1`)
      .all<{ kind: Kind }>();
    return c.json({ providers: rows.results.map((r) => r.kind) });
  } catch {
    return c.json({ providers: [] });
  }
});

export default authProviders;
