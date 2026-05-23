// Invite helpers shared by the Better Auth gate (auth/index.ts) and the invite
// routes. An invite is the single mechanism that authorizes account creation
// after bootstrap — by email, so it covers email/password accept, direct-create,
// and a first OAuth sign-in uniformly.

import type { Env } from '../env';
import { sha256Hex } from './ids';

export type InstanceRole = 'owner' | 'admin' | 'member';
export type ProjectRole = 'admin' | 'viewer';

export type InviteRow = {
  id: string;
  email: string | null;
  instance_role: 'admin' | 'member';
  token_hash: string;
  created_by: string | null;
  created_at: number;
  expires_at: number | null;
  accepted_at: number | null;
  accepted_user: string | null;
  revoked_at: number | null;
};

// Usable = not accepted, not revoked, not expired.
const OPEN = `accepted_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)`;

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

// Mark the invite accepted and apply its pre-assigned project memberships to the
// new user. Called from the user.create.after hook. The accepted_at guard makes
// concurrent accepts a no-op for the loser.
export async function consumeInvite(env: Env, invite: InviteRow, userId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB
    .prepare(`UPDATE invites SET accepted_at = ?, accepted_user = ? WHERE id = ? AND accepted_at IS NULL`)
    .bind(now, userId, invite.id)
    .run();

  const projs = await env.DB
    .prepare(`SELECT project_id, role FROM invite_projects WHERE invite_id = ?`)
    .bind(invite.id)
    .all<{ project_id: string; role: ProjectRole }>();
  if (projs.results.length === 0) return;

  await env.DB.batch(
    projs.results.map((p) =>
      env.DB
        .prepare(
          `INSERT INTO project_members (user_id, project_id, role, added_at, added_by)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(user_id, project_id) DO UPDATE SET role = excluded.role`
        )
        .bind(userId, p.project_id, p.role, now, invite.created_by)
    )
  );
}
