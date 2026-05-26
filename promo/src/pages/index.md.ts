import type { APIRoute } from 'astro';

// Markdown mirror of the home page for AI tools that prefer raw markdown.
export const GET: APIRoute = ({ site }) => {
  const u = (p = '') => new URL(p, site).href;
  const body = `# nodrix — your own IoT cloud, on Cloudflare

An open-source IoT backend that runs entirely in your own Cloudflare account — plain-HTTPS hardware, realtime drag-and-drop dashboards, automations, and one clean read API. No broker, no servers, no middleman.

## Features
- **Telemetry over plain HTTPS** — devices POST JSON; variables auto-create on first sight. No MQTT broker, no SDK.
- **Realtime dashboards, two-way** — bind widgets to variables; live updates over hibernating WebSockets, and toggles/sliders/buttons write back to hardware.
- **Automations without a server** — trigger on thresholds, schedules, sunrise/sunset, or events; act via variables, webhooks, or Slack.
- **A clean read API** — edge-cached state, time-series, and listings behind one bearer token.
- **Single-tenant by design** — every deploy lands in your own account.
- **MCP for AI clients** — optional MCP server lets Claude, Claude Code, and any other MCP-aware client query projects and (with your explicit toggle) drive automations. Owner-gated, off by default, audit-logged.

## How it works
1. **Deploy in one click** to Cloudflare (provisions D1, R2, KV, and the Worker).
2. **Claim your instance** — first account becomes the owner.
3. **Connect hardware** — point a device at /v1/telemetry with a project token.
4. **Build & automate** — compose dashboards and wire automations.

## Runs on
Cloudflare Workers, Durable Objects, D1, R2, KV.

## Links
- Docs: ${u('docs')}
- Widgets: ${u('widgets')}
- Source: https://github.com/decoded-cipher/nodrix
`;
  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } });
};
