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

// Delete the now-accepted invite (throwaway). The new user's role + project were
// applied at INSERT by the user.create.before hook, so this just cleans up:
// delete by email — which removes this invite plus any other pending invites for
// the same address (now a registered user). Called from user.create.after.
export async function consumeInvite(env: Env, invite: InviteRow): Promise<void> {
  await (invite.email
    ? env.DB.prepare(`DELETE FROM invites WHERE email = ?`).bind(invite.email)
    : env.DB.prepare(`DELETE FROM invites WHERE id = ?`).bind(invite.id)
  ).run();
}
