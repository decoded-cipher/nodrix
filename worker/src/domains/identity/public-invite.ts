import { Hono } from 'hono';
import type { Env } from '../../env';
import { findOpenInviteByToken } from '../../platform/lib/invites';
import { buildAuth } from '../../platform/auth';
import { clientKey, overLimit } from '../../platform/middleware/rate-limit';

// Public invite endpoints (no session) — used by the /invite/<token> accept page.
// The token is verified here and the invite id is handed to the create-gate,
// which applies the invite's role; the after-hook consumes the invite.

const invite = new Hono<{ Bindings: Env }>();

// GET /v1/public/invite/:token — preview for the accept page.
invite.get('/:token', async (c) => {
  const token = c.req.param('token');
  const row = await findOpenInviteByToken(c.env, token);
  if (!row) return c.json({ valid: false }, 404);

  const inviter = row.created_by
    ? await c.env.DB.prepare(`SELECT email FROM users WHERE id = ?`).bind(row.created_by).first<{ email: string }>()
    : null;

  return c.json({
    valid: true,
    email: row.email,
    instance_role: row.instance_role,
    inviter_email: inviter?.email ?? null,
  });
});

// POST /v1/public/invite/accept  body: { token, password, name? }
// On success, returns the Better Auth sign-up response WITH the session cookie,
// so the invitee is signed in immediately.
invite.post('/accept', async (c) => {
  if (await overLimit(c.env, `invite:${clientKey(c.req.raw)}`, 10, 60)) {
    return c.json({ error: 'too_many_requests' }, 429);
  }
  const body = await c.req.json<{ token?: string; password?: string; name?: string | null }>();
  const token = (body.token ?? '').trim();
  const password = body.password ?? '';
  if (!token || !password) return c.json({ error: 'bad_request', reason: 'missing_fields' }, 400);

  const row = await findOpenInviteByToken(c.env, token);
  if (!row || !row.email) return c.json({ error: 'invalid_invite' }, 400);

  const name = (body.name ?? '').trim() || row.email.split('@')[0]!;
  try {
    const auth = await buildAuth(c.env, c.req.raw, c.executionCtx, { inviteId: row.id });
    // asResponse → carries the Set-Cookie session so the SPA is logged in.
    return await auth.api.signUpEmail({
      body: { email: row.email, password, name },
      asResponse: true,
    });
  } catch (e) {
    console.error(`[invite] accept failed: ${(e as Error).message}`);
    return c.json({ error: 'signup_failed' }, 400);
  }
});

export default invite;
