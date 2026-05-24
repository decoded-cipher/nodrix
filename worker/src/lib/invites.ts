// Invite helpers shared by the Better Auth gate (auth/index.ts) and the invite
// routes. An invite is the single mechanism that authorizes account creation
// after bootstrap — by email, so it covers email/password accept, direct-create,
// and a first OAuth sign-in uniformly.

import type { Env } from '../env';
import { sha256Hex } from './ids';

export type InstanceRole = 'owner' | 'admin' | 'member';

export type InviteRow = {
  id: string;
  email: string | null;
  instance_role: 'admin' | 'member';
  token_hash: string;
  created_by: string | null;
  created_at: number;
  expires_at: number | null;
};

// A row only exists while pending (accept/revoke delete it), so "open" is just
// "not expired".
const OPEN = `(expires_at IS NULL OR expires_at > ?)`;

export async function findOpenInviteByEmail(env: Env, email: string): Promise<InviteRow | null> {
  const now = Math.floor(Date.now() / 1000);
  return env.DB
    .prepare(`SELECT * FROM invites WHERE email = ? AND ${OPEN} ORDER BY created_at DESC LIMIT 1`)
    .bind(email.toLowerCase(), now)
    .first<InviteRow>();
}

export async function findOpenInviteByToken(env: Env, token: string): Promise<InviteRow | null> {
  const now = Math.floor(Date.now() / 1000);
  const hash = await sha256Hex(token);
  return env.DB
    .prepare(`SELECT * FROM invites WHERE token_hash = ? AND ${OPEN} LIMIT 1`)
    .bind(hash, now)
    .first<InviteRow>();
}

// Apply the invite's pre-assigned project memberships to the new user, then
// delete the invite (throwaway). Read invite_projects first, then delete by
// email — which removes this invite plus any other pending invites for the same
// address (now a registered user) and cascades their invite_projects rows.
// Called from the user.create.after hook.
export async function consumeInvite(env: Env, invite: InviteRow, userId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  const projs = await env.DB
    .prepare(`SELECT project_id FROM invite_projects WHERE invite_id = ?`)
    .bind(invite.id)
    .all<{ project_id: string }>();

  const stmts = projs.results.map((p) =>
    env.DB
      .prepare(
        `INSERT INTO project_members (user_id, project_id, added_at, added_by)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id, project_id) DO NOTHING`
      )
      .bind(userId, p.project_id, now, invite.created_by)
  );
  stmts.push(
    invite.email
      ? env.DB.prepare(`DELETE FROM invites WHERE email = ?`).bind(invite.email)
      : env.DB.prepare(`DELETE FROM invites WHERE id = ?`).bind(invite.id)
  );

  await env.DB.batch(stmts);
}
