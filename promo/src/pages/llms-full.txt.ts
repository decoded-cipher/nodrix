import type { APIRoute } from 'astro';

// llms-full.txt — the full text of the site in one document, for deep LLM ingestion.
export const GET: APIRoute = ({ site }) => {
  const u = (p = '') => new URL(p, site).href;
  const repo = 'https://github.com/decoded-cipher/nodrix';

  const body = `# nodrix — full reference

> nodrix is an open-source, single-tenant IoT cloud that deploys to your own Cloudflare account. Hardware speaks plain HTTPS, telemetry streams to realtime drag-and-drop dashboards, automations run at the edge, and a clean read API exposes the data — with no broker, no servers, and nothing leaving your account. Status: pre-alpha. License: MIT.

Home: ${u()}
Docs: ${u('docs')}
Widgets: ${u('widgets')}
Source: ${repo}

## What nodrix is
- An open-source IoT backend that deploys straight into the user's own Cloudflare account.
- Single-tenant: every deployment is isolated in the owner's account, on their own D1, R2, and Durable Objects.
- One-click "Deploy to Cloudflare" provisions Workers, Durable Objects, D1, R2, and KV.
- Runs entirely on Cloudflare primitives — nothing to host, nothing to maintain.

## Features
1. Telemetry over plain HTTPS — Hardware POSTs JSON to the project. Variables create themselves on first sight: no schema to declare, no MQTT broker to run, no SDK to install. Anything that can make an HTTPS request can talk to nodrix.
2. Realtime dashboards, two-way — Drop widgets onto a grid, bind them to variables, watch values stream live over hibernating WebSockets that cost nothing while idle. Toggles, sliders, and buttons write back to hardware on the same channel; devices ack when applied.
3. Automations without a server — Fire on a variable threshold, a clock, sunrise/sunset, or a custom event. Then set variables, call webhooks, or ping Slack — all running at the edge.
4. A clean read API — Edge-cached latest state, recent time-series, and variable listings behind one bearer token. Plug in Grafana, a React app, or a Raspberry Pi screen.
5. Single-tenant by design — Every deploy lands in the user's own account. Email + password out of the box, with optional Google or GitHub sign-in.
6. MCP server for AI clients — Optional, off by default, owner-gated. Two transports on the same worker: bearer-token at /v1/mcp (for CLI/IDE clients like Claude Code) and OAuth 2.1 at /v1/mcp/oauth (for browser-based clients like claude.ai connectors). Read tools (list/get projects, variables, dashboards, automations, integrations, state, series) are exposed when the server is on; management tools (create/update of projects, variables, dashboards, automations, integrations; run automations; set variable values) require an additional deployment-wide writes toggle AND an explicit mcp:manage scope at the consent step. No delete operations are ever exposed. Every write is recorded in the audit log when enabled, tagged with source=mcp so AI-initiated changes are distinguishable from web/API ones.

## How it works (four steps)
1. Deploy in one click — Hit "Deploy to Cloudflare". It provisions D1, R2, KV, and the Worker straight into the account.
2. Claim the instance — Open the worker URL and create the first account; it becomes the owner. Spin up the first project in a couple of clicks.
3. Connect hardware — Mint a project token and point the device at /v1/telemetry. Variables show up the moment data starts flowing.
4. Build & automate — Compose a dashboard, bind widgets to variables, and wire automations to act on the data — or hand it off through the read API.

## Device protocol (overview)
- Send telemetry: POST /v1/telemetry with header "Authorization: Bearer <project-token>" and a JSON body like { "metrics": { "temperature": 23.4, "humidity": 61 } }. Responds 204 No Content; variables are auto-created.
- Read state: GET /v1/projects/:proj/state returns the latest value per variable, edge-cached.

## Widgets (framework-agnostic Web Components)
Display:
- iot-value — The latest reading of a single variable, large and legible. Attributes: data-title, data-unit.
- iot-gauge — An arc gauge for a numeric variable with configurable min/max bounds. Attributes: data-title, data-min, data-max, data-unit.
- iot-chart — A multi-series time-series chart (ApexCharts): line, area, bar, or stepline, with optional drag-to-zoom. Attributes: data-title, data-chart-type, data-zoom.
Control:
- iot-toggle — On/off switch that writes a value to a variable and reflects last reported state. Attributes: data-title, data-variable, data-on-value, data-off-value.
- iot-slider — Horizontal slider for a numeric write; commits on release. Attributes: data-title, data-variable, data-min, data-max, data-step.
- iot-push — Momentary push button for one-shot commands. Attributes: data-title, data-variable, data-value, data-label.

## Tech stack
Cloudflare Workers, Durable Objects, D1, R2, and KV.

## Source & license
- Repository: ${repo}
- License: MIT
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
