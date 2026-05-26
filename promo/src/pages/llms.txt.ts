import type { APIRoute } from 'astro';

// llms.txt — a concise, LLM-friendly map of the site.
// Convention: https://llmstxt.org
export const GET: APIRoute = ({ site }) => {
  const u = (p = '') => new URL(p, site).href;
  const repo = 'https://github.com/decoded-cipher/nodrix';

  const body = `# nodrix

> nodrix is an open-source, single-tenant IoT cloud that deploys to your own Cloudflare account. Hardware speaks plain HTTPS, telemetry streams to realtime drag-and-drop dashboards, automations run at the edge, and a clean read API exposes the data — with no broker, no servers, and nothing leaving your account.

## What it is
- Open-source (MIT), pre-alpha IoT backend for Cloudflare.
- Single-tenant: every deployment lives in the user's own Cloudflare account.
- One-click "Deploy to Cloudflare" — provisions Workers, Durable Objects, D1, R2, and KV.
- Devices send telemetry over plain HTTPS (POST /v1/telemetry); variables auto-create on first sight. No MQTT broker, no SDK.
- Realtime dashboards built from drag-and-drop widgets over hibernating WebSockets.
- Two-way control: toggles/sliders/buttons write values back to hardware.
- Edge automations: trigger on variable thresholds, schedules, sunrise/sunset, or custom events; act via variables, webhooks, or Slack.
- Clean read API: edge-cached latest state, time-series, and variable listings behind one bearer token.
- Optional MCP (Model Context Protocol) server — owner-gated, off by default. Lets Claude, Claude Code, and any MCP-aware client read projects and (with an explicit toggle) drive automations. Bearer transport at /v1/mcp; OAuth at /v1/mcp/oauth.

## Pages
- [Home](${u()}): Product overview, features, and how it works.
- [Documentation](${u('docs')}): Device protocol, read API, automation model, and MCP.
- [Widgets](${u('widgets')}): Built-in, framework-agnostic Web Component widgets.

## Markdown & full text (for machines)
- [Full text](${u('llms-full.txt')}): The entire site in one document.
- [Home (markdown)](${u('index.md')})
- [Docs (markdown)](${u('docs.md')})
- [Widgets (markdown)](${u('widgets.md')})

## Tech stack
- Cloudflare Workers, Durable Objects, D1, R2, KV.

## Source
- [GitHub repository](${repo})
- License: MIT
`;

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};
