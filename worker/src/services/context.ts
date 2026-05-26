// Who is performing a service call, independent of how they authenticated.
// HTTP routes build this from the Better Auth session; MCP builds it from the
// token's creator (so MCP never grants more than the human behind the token).

export type ActorRole = 'owner' | 'admin' | 'member';

export type Actor = {
  userId: string;
  role: ActorRole;
  source: 'http' | 'mcp';
};

export function isInstanceAdmin(actor: Actor): boolean {
  return actor.role === 'owner' || actor.role === 'admin';
}
