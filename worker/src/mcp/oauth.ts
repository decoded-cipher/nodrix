// OAuth 2.1 authorization endpoint (Phase 2). The token, registration, and
// discovery (.well-known) endpoints are served by @cloudflare/workers-oauth-provider
// itself; this module renders the human consent step at /authorize and completes
// the grant. The actual MCP access tokens are minted and validated by the
// provider — this only authenticates the consenting user (via the existing Better
// Auth session) and decides the grant's authority.
//
// The grant's props are McpProps, so the OAuth-authed agent path scopes tools
// exactly like the bearer path: authority is the consenting user's role, capped
// by the scope they grant on this screen.

import { Hono } from 'hono';
import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../env';
import { buildAuth } from '../platform/auth';
import { mcpEnabled } from './flags';
import type { McpProps } from './gate';
import type { ActorRole } from '../platform/lib/service';

const oauth = new Hono<{ Bindings: Env }>();

type SessionUser = { id: string; email: string; role: ActorRole };

async function currentUser(env: Env, req: Request): Promise<SessionUser | null> {
  try {
    const auth = await buildAuth(env, req);
    const s = await auth.api.getSession({ headers: req.headers });
    if (!s?.user?.id) return null;
    const u = s.user as unknown as { id: string; email: string; role?: ActorRole };
    return { id: u.id, email: u.email, role: u.role ?? 'member' };
  } catch {
    return null;
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!
  );
}

function b64encode(s: string): string {
  return btoa(unescape(encodeURIComponent(s)));
}
function b64decode(s: string): string {
  return decodeURIComponent(escape(atob(s)));
}

// GET /authorize — render the consent screen (or bounce to login).
oauth.get('/', async (c) => {
  if (!(await mcpEnabled(c.env))) return c.text('not found', 404);

  let authReq: AuthRequest;
  try {
    authReq = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch {
    return c.text('invalid authorization request', 400);
  }

  const user = await currentUser(c.env, c.req.raw);
  if (!user) {
    const url = new URL(c.req.url);
    return c.redirect(`/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const client = await c.env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
  const clientName = client?.clientName?.trim() || authReq.clientId;
  const wantsManage = (authReq.scope ?? []).includes('mcp:manage');
  const payload = b64encode(JSON.stringify(authReq));

  return c.html(consentPage({ clientName, email: user.email, wantsManage, payload }));
});

// POST /authorize/consent — approve or deny.
oauth.post('/consent', async (c) => {
  if (!(await mcpEnabled(c.env))) return c.text('not found', 404);

  const user = await currentUser(c.env, c.req.raw);
  if (!user) return c.text('unauthorized', 401);

  const form = await c.req.formData();
  const decision = form.get('decision');
  let authReq: AuthRequest;
  try {
    authReq = JSON.parse(b64decode(String(form.get('req') ?? ''))) as AuthRequest;
  } catch {
    return c.text('invalid request', 400);
  }

  if (decision !== 'approve') {
    const u = new URL(authReq.redirectUri);
    u.searchParams.set('error', 'access_denied');
    if (authReq.state) u.searchParams.set('state', authReq.state);
    return c.redirect(u.toString());
  }

  // Authority: read by default; "manage" only if the user explicitly grants it.
  // Write tools still require the deployment-wide mcp_write_enabled flag.
  const manage = form.get('grant') === 'manage';
  const grantedScopes = manage ? ['mcp:read', 'mcp:manage'] : ['mcp:read'];
  const props: McpProps = {
    tokenId: 'oauth',
    scope: manage ? 'admin' : 'read',
    projectId: null,
    createdBy: user.id,
    role: user.role,
  };

  const { redirectTo } = await c.env.OAUTH_PROVIDER.completeAuthorization({
    request: authReq,
    userId: user.id,
    metadata: { clientId: authReq.clientId },
    scope: grantedScopes,
    props,
  });
  return c.redirect(redirectTo);
});

function consentPage(o: { clientName: string; email: string; wantsManage: boolean; payload: string }): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize ${esc(o.clientName)}</title>
<style>
  :root { color-scheme: light dark; }
  body { font: 15px/1.5 system-ui, sans-serif; margin: 0; display: grid; min-height: 100vh; place-items: center; background: #f5f5f5; }
  @media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #e5e5e5; } .card { background: #171717 !important; border-color: #262626 !important; } }
  .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 12px; padding: 28px; max-width: 420px; width: calc(100% - 32px); box-shadow: 0 1px 3px rgba(0,0,0,.08); }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p { margin: 8px 0; color: #525252; } @media (prefers-color-scheme: dark){ p { color:#a3a3a3; } }
  .who { font-weight: 600; }
  fieldset { border: 1px solid #e5e5e5; border-radius: 8px; margin: 16px 0; padding: 12px; } @media (prefers-color-scheme: dark){ fieldset{ border-color:#262626; } }
  label.opt { display: flex; gap: 8px; align-items: flex-start; padding: 6px 0; cursor: pointer; }
  .row { display: flex; gap: 10px; margin-top: 16px; }
  button { flex: 1; padding: 10px; border-radius: 8px; border: 1px solid transparent; font-weight: 600; cursor: pointer; font-size: 14px; }
  .approve { background: #ea580c; color: #fff; }
  .deny { background: transparent; border-color: #d4d4d4; color: inherit; } @media (prefers-color-scheme: dark){ .deny{ border-color:#404040; } }
  small { color: #737373; }
</style></head>
<body>
  <form class="card" method="post" action="/authorize/consent">
    <h1>Authorize ${esc(o.clientName)}</h1>
    <p><span class="who">${esc(o.clientName)}</span> wants to access your nodrix data as <span class="who">${esc(o.email)}</span>.</p>
    <input type="hidden" name="req" value="${esc(o.payload)}" />
    <fieldset>
      <legend>Access level</legend>
      <label class="opt"><input type="radio" name="grant" value="read" ${o.wantsManage ? '' : 'checked'} /> <span><strong>Read only</strong><br><small>List and read projects, variables, state, dashboards, automations.</small></span></label>
      <label class="opt"><input type="radio" name="grant" value="manage" ${o.wantsManage ? 'checked' : ''} /> <span><strong>Read &amp; manage</strong><br><small>Also create/update and run automations, and set variable values. No deletes. Control writes still require the owner's MCP write toggle.</small></span></label>
    </fieldset>
    <p><small>You can revoke this connection anytime from your account.</small></p>
    <div class="row">
      <button class="deny" type="submit" name="decision" value="deny">Deny</button>
      <button class="approve" type="submit" name="decision" value="approve">Approve</button>
    </div>
  </form>
</body></html>`;
}

export default oauth;
