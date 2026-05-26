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

import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { AuthRequest } from '@cloudflare/workers-oauth-provider';
import type { Env } from '../env';
import { buildAuth } from '../platform/auth';
import { mcpEnabled, mcpWriteEnabled } from './flags';
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
  if (!(await mcpEnabled(c.env))) return errorResponse(c, 404, 'MCP server is off', "The owner hasn't enabled MCP connections for this nodrix.");

  let authReq: AuthRequest;
  try {
    authReq = await c.env.OAUTH_PROVIDER.parseAuthRequest(c.req.raw);
  } catch {
    return errorResponse(c, 400, 'Invalid authorization request', 'The link is missing or malformed. Try starting the connection again from the MCP client.');
  }

  const user = await currentUser(c.env, c.req.raw);
  if (!user) {
    const url = new URL(c.req.url);
    return c.redirect(`/login?redirect=${encodeURIComponent(url.pathname + url.search)}`);
  }

  const client = await c.env.OAUTH_PROVIDER.lookupClient(authReq.clientId);
  const clientName = client?.clientName?.trim() || authReq.clientId;
  const redirectHost = safeHost(authReq.redirectUri);
  const wantsManage = (authReq.scope ?? []).includes('mcp:manage');
  const writesEnabled = await mcpWriteEnabled(c.env);
  const payload = b64encode(JSON.stringify(authReq));

  return c.html(consentPage({
    clientName,
    redirectHost,
    email: user.email,
    wantsManage,
    writesEnabled,
    payload,
  }));
});

// POST /authorize/consent — approve or deny.
oauth.post('/consent', async (c) => {
  if (!(await mcpEnabled(c.env))) return errorResponse(c, 404, 'MCP server is off', 'The owner disabled MCP between when you started and when you submitted.');

  const user = await currentUser(c.env, c.req.raw);
  if (!user) return errorResponse(c, 401, 'Session expired', 'Sign in again and retry the connection.');

  const form = await c.req.formData();
  const decision = form.get('decision');
  let authReq: AuthRequest;
  try {
    authReq = JSON.parse(b64decode(String(form.get('req') ?? ''))) as AuthRequest;
  } catch {
    return errorResponse(c, 400, 'Invalid request', 'The submitted form was malformed. Start over from the MCP client.');
  }

  if (decision !== 'approve') {
    const u = new URL(authReq.redirectUri);
    u.searchParams.set('error', 'access_denied');
    if (authReq.state) u.searchParams.set('state', authReq.state);
    return c.redirect(u.toString());
  }

  // Authority is read by default. Manage is only honored when (a) the user
  // explicitly grants it AND (b) the deployment-wide writes flag is on; absent
  // either, the grant silently downgrades to read so a stale UI choice can't
  // produce a token more powerful than the owner allows.
  const requestedManage = form.get('grant') === 'manage';
  const writesEnabled = await mcpWriteEnabled(c.env);
  const manage = requestedManage && writesEnabled;
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

function safeHost(uri: string): string {
  try { return new URL(uri).host; } catch { return uri; }
}

function errorResponse(
  c: Context,
  status: ContentfulStatusCode,
  title: string,
  body: string,
): Response {
  return c.html(errorPage({ title, body }), status);
}

// ─── Page renderers ──────────────────────────────────────────────────────────
// Both pages share the same chrome so deny/approve/error flows look continuous.

const SHARED_STYLES = `
  :root { color-scheme: light dark; --accent: #ea580c; --accent-hover: #c2410c; }
  * { box-sizing: border-box; }
  body { font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f5f5f5; color: #171717; padding: 24px; }
  @media (prefers-color-scheme: dark) { body { background: #0a0a0a; color: #e5e5e5; } }
  .card { background: #fff; border: 1px solid #e5e5e5; border-radius: 14px; padding: 28px; max-width: 460px; width: 100%; box-shadow: 0 4px 24px -8px rgba(0,0,0,.08); }
  @media (prefers-color-scheme: dark) { .card { background: #171717; border-color: #262626; box-shadow: 0 4px 24px -8px rgba(0,0,0,.4); } }
  h1 { font-size: 18px; font-weight: 600; margin: 0 0 6px; letter-spacing: -0.01em; }
  .muted { color: #737373; font-size: 13px; }
  @media (prefers-color-scheme: dark) { .muted { color: #a3a3a3; } }
  .strong { font-weight: 600; }
  code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12.5px; padding: 1px 5px; border-radius: 4px; background: #f3f3f3; color: #404040; }
  @media (prefers-color-scheme: dark) { code { background: #262626; color: #d4d4d4; } }
  .btn { padding: 9px 14px; border-radius: 8px; border: 1px solid transparent; font-weight: 600; cursor: pointer; font-size: 14px; font-family: inherit; transition: background .12s; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-primary:hover { background: var(--accent-hover); }
  .btn-ghost { background: transparent; border-color: #d4d4d4; color: inherit; }
  .btn-ghost:hover { background: #f5f5f5; }
  @media (prefers-color-scheme: dark) { .btn-ghost { border-color: #404040; } .btn-ghost:hover { background: #262626; } }
`;

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<style>${SHARED_STYLES}</style>
</head><body>${body}</body></html>`;
}

const READ_TOOLS = [
  'Browse projects, variables, dashboards',
  'Read current state and recent telemetry',
  'View automations and integrations (secrets redacted)',
];
const MANAGE_TOOLS = [
  'Create &amp; update projects, variables, dashboards',
  'Create, update, and run automations',
  'Create &amp; update integrations',
  'Send commands to hardware (set variable values)',
];

function consentPage(o: {
  clientName: string;
  redirectHost: string;
  email: string;
  wantsManage: boolean;
  writesEnabled: boolean;
  payload: string;
}): string {
  const readList = READ_TOOLS.map((t) => `<li>${t}</li>`).join('');
  const manageList = MANAGE_TOOLS.map((t) => `<li>${t}</li>`).join('');
  const manageBlocked = o.wantsManage && !o.writesEnabled;

  // Three render branches: manage requested + allowed (radio choice),
  // manage requested + blocked (notice that grant will downgrade to read),
  // read-only requested (no choice).
  const scopeBlock = o.wantsManage && o.writesEnabled
    ? `<fieldset class="scope">
        <legend>Access level</legend>
        <label class="opt">
          <input type="radio" name="grant" value="read" />
          <div>
            <div class="strong">Read only</div>
            <ul class="tool-list">${readList}</ul>
          </div>
        </label>
        <label class="opt">
          <input type="radio" name="grant" value="manage" checked />
          <div>
            <div class="strong">Read &amp; manage <span class="chip chip-warn">elevated</span></div>
            <ul class="tool-list">${readList}${manageList}</ul>
            <div class="muted">No delete operations are ever exposed.</div>
          </div>
        </label>
      </fieldset>`
    : `<div class="scope-static">
        <div class="strong">${manageBlocked ? 'Read access (manage was requested but is disabled)' : 'Read access'}</div>
        <ul class="tool-list">${readList}</ul>
        ${manageBlocked
          ? `<div class="notice">${esc(o.clientName)} requested management access, but the owner has it disabled deployment-wide. Approving will grant read access only.</div>`
          : ''}
      </div>`;

  const extraStyles = `
    .header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 16px; }
    .who { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: #525252; margin-top: 6px; }
    @media (prefers-color-scheme: dark) { .who { color: #a3a3a3; } }
    .scope { border: 1px solid #e5e5e5; border-radius: 10px; padding: 4px; margin: 16px 0 12px; }
    @media (prefers-color-scheme: dark) { .scope { border-color: #262626; } }
    .scope legend { padding: 0 6px; font-size: 12px; color: #737373; font-weight: 500; }
    .scope-static { border: 1px solid #e5e5e5; border-radius: 10px; padding: 12px; margin: 16px 0 12px; }
    @media (prefers-color-scheme: dark) { .scope-static { border-color: #262626; } }
    .opt { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 8px; cursor: pointer; }
    .opt:hover { background: #fafafa; }
    @media (prefers-color-scheme: dark) { .opt:hover { background: #1f1f1f; } }
    .opt input { margin-top: 4px; accent-color: var(--accent); }
    .opt + .opt { border-top: 1px solid #f0f0f0; }
    @media (prefers-color-scheme: dark) { .opt + .opt { border-top-color: #262626; } }
    .tool-list { margin: 6px 0 0; padding-left: 18px; font-size: 13px; color: #525252; }
    @media (prefers-color-scheme: dark) { .tool-list { color: #a3a3a3; } }
    .tool-list li { margin: 2px 0; }
    .chip { display: inline-block; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; padding: 2px 6px; border-radius: 4px; vertical-align: middle; margin-left: 6px; }
    .chip-warn { background: #fef3c7; color: #92400e; }
    @media (prefers-color-scheme: dark) { .chip-warn { background: rgba(120, 53, 15, 0.4); color: #fcd34d; } }
    .notice { margin-top: 10px; padding: 8px 10px; border-radius: 6px; background: #fef3c7; color: #92400e; font-size: 12.5px; }
    @media (prefers-color-scheme: dark) { .notice { background: rgba(120, 53, 15, 0.25); color: #fcd34d; } }
    .revoke-hint { margin: 14px 0 0; padding: 8px 10px; border-radius: 6px; background: #f5f5f5; font-size: 12px; color: #525252; }
    @media (prefers-color-scheme: dark) { .revoke-hint { background: #1f1f1f; color: #a3a3a3; } }
    .row { display: flex; gap: 10px; margin-top: 18px; }
    .row .btn { flex: 1; }
  `;

  const body = `
<form class="card" method="post" action="/authorize/consent">
  <div class="header">
    <h1>Connect <span style="color:var(--accent)">${esc(o.clientName)}</span></h1>
    <div class="muted">to your nodrix data, as <span class="strong">${esc(o.email)}</span>.</div>
    <div class="who">redirects to <code>${esc(o.redirectHost)}</code></div>
  </div>

  <input type="hidden" name="req" value="${esc(o.payload)}" />

  ${scopeBlock}

  <div class="revoke-hint">You can revoke this connection anytime from your account settings.</div>

  <div class="row">
    <button class="btn btn-ghost" type="submit" name="decision" value="deny">Deny</button>
    <button class="btn btn-primary" type="submit" name="decision" value="approve">Approve</button>
  </div>
</form>
<style>${extraStyles}</style>`;

  return shell(`Authorize ${o.clientName}`, body);
}

function errorPage(o: { title: string; body: string }): string {
  const extraStyles = `
    .icon { width: 44px; height: 44px; border-radius: 50%; background: #fee2e2; color: #b91c1c; display: grid; place-items: center; font-size: 24px; margin-bottom: 14px; }
    @media (prefers-color-scheme: dark) { .icon { background: rgba(127, 29, 29, 0.3); color: #fca5a5; } }
    .err-actions { margin-top: 18px; }
  `;

  const body = `
<div class="card">
  <div class="icon">!</div>
  <h1>${esc(o.title)}</h1>
  <div class="muted">${esc(o.body)}</div>
  <div class="err-actions">
    <a class="btn btn-ghost" href="/" style="text-decoration:none;display:inline-block;">Back to nodrix</a>
  </div>
</div>
<style>${extraStyles}</style>`;

  return shell(o.title, body);
}

export default oauth;
