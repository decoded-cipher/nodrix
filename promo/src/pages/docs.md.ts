import type { APIRoute } from 'astro';

// Markdown mirror of the docs page.
export const GET: APIRoute = ({ site }) => {
  const u = (p = '') => new URL(p, site).href;
  const body = `# nodrix documentation

Deploy, claim, and connect: the nodrix device protocol, read API, and automation model.

## Deploy & claim
1. Hit "Deploy to Cloudflare" — it provisions D1, R2, KV, and the Worker into your account.
2. Open the worker URL and create the first account; it becomes the owner.
3. Create your first project.

## Tokens
Mint a project token (a bearer token) to authenticate device telemetry and read-API calls.

## Device protocol
Send telemetry:

\`\`\`
POST /v1/telemetry
Authorization: Bearer <project-token>

{ "metrics": { "temperature": 23.4, "humidity": 61 } }

→ 204 No Content   # variables auto-created
\`\`\`

## Read API
Read the latest state:

\`\`\`
GET /v1/projects/:proj/state

→ { "temperature": { "value": 23.4, "received_at": 171590… } }
\`\`\`

Edge-cached latest state, recent time-series, and variable listings sit behind one bearer token.

## Automations
Fire on a variable threshold, a clock, sunrise/sunset, or a custom event. Then set variables, call webhooks, or ping Slack — all running at the edge.

## Links
- Home: ${u()}
- Widgets: ${u('widgets')}
- Source: https://github.com/decoded-cipher/nodrix
`;
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
