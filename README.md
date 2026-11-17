# nodrix

**The IoT platform Cloudflare didn't build.**

nodrix is a self-hosted, open-source IoT platform that runs in your own Cloudflare account on Workers, Durable Objects, D1, and R2. Devices send telemetry over HTTPS or WebSocket, and you get realtime dashboards, two-way control, automations, a read API, and an MCP server for AI assistants. It is single-tenant: your data never leaves your account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://nodrix.live/go/deploy)

[Website](https://nodrix.live) · [Docs](https://nodrix.live/docs) · [Changelog](https://nodrix.live/changelog) · [Roadmap](https://nodrix.live/roadmap)

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Connecting hardware](#connecting-hardware)
- [AI assistants (MCP)](#ai-assistants-mcp)
- [Architecture](#architecture)
- [Development](#development)
- [Security](#security)
- [License](#license)

## Features

- **Telemetry over HTTPS or WebSocket.** Devices POST JSON to a project, and variables are created the first time they appear. No schema to define and no MQTT broker to run.
- **Realtime dashboards.** A drag-and-drop widget grid streams updates over hibernating WebSockets. Any dashboard can be shared read-only by public link.
- **Embeddable widgets.** Every widget is a framework-agnostic Web Component you can use in your own app.
- **Two-way control.** Toggles, sliders, color pickers, and buttons write values back to hardware through short polls or a control socket.
- **Visual automations.** Variable, schedule, sunrise/sunset, and event triggers run conditions and actions, including webhooks, code snippets, and integrations.
- **Integrations.** HTTP, email, and chat (Slack, Telegram, Discord, and more).
- **Read API.** Latest state, time-series, and variable listings behind one token.
- **MCP server.** Read telemetry and control hardware from an AI assistant. Owner-gated and off by default.
- **Multi-user.** Owner, admin, and member roles with email invites. Email and password sign-in is on by default, and Google or GitHub sign-in can be turned on in **Settings → Sign-in providers**.
- **Audit log.** Every privileged action is recorded and browsable in the UI.

## Getting started

### Deploy

Click **Deploy to Cloudflare** above to create nodrix and its storage in your Cloudflare account. To deploy from a clone instead, see [Development](#development).

### First steps

1. Open your Worker's URL and create the owner account. The first sign-up becomes the owner; after that, people join by invite from **Users**.
2. Create a project and a project token.
3. Send telemetry. Variables are created as soon as data arrives:

   ```bash
   curl -X POST https://<your-worker>/v1/telemetry \
     -H "Authorization: Bearer $NODRIX_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"metrics":{"temperature":23.4,"humidity":61}}'
   ```

4. Read it back:

   ```bash
   curl https://<your-worker>/v1/projects/<project>/state \
     -H "Authorization: Bearer $NODRIX_TOKEN"
   ```

## Connecting hardware

For ESP32 and ESP8266, use the [Nodrix library](https://github.com/decoded-cipher/nodrix-sdk). It is available from the Arduino Library Manager, the PlatformIO Registry (`decoded-cipher/Nodrix`), and the ESP Component Registry.

Any other device that can make an HTTPS request can use the telemetry API above.

## AI assistants (MCP)

nodrix includes a [Model Context Protocol](https://modelcontextprotocol.io) server at `/v1/mcp` (Streamable HTTP). An assistant can read your telemetry and, once you allow it, control your hardware. Devices report to your deployment, so the board does not need to be connected to the machine running the assistant.

| Client | How to connect |
|---|---|
| Claude Code | `/plugin install nodrix --marketplace decoded-cipher/nodrix`, then enter your endpoint. See [plugin/](plugin). |
| claude.ai, ChatGPT | Add `https://<your-worker>/v1/mcp` as a custom connector and sign in on your instance. |
| Codex | `codex mcp add nodrix --url https://<your-worker>/v1/mcp`, then `codex mcp login nodrix`. |
| Other clients | Send an API token from **Settings → Tokens** as `Authorization: Bearer <token>`. |

The server is off by default. The owner turns it on from the **MCP server** card in **Settings**, which has two switches:

- **MCP server** (`mcp_enabled`). While it is off, `/v1/mcp` returns 404.
- **Allow control writes** (`mcp_write_enabled`). Until it is on, every client gets read-only tools, even with an admin token.

There are 12 read tools and 16 write tools, and no delete tools. Every tool is checked against the access of the person behind the token or sign-in. See the [MCP server reference](https://nodrix.live/products/mcp) for the full tool list.

`/v1/mcp/oauth` still works as an alias for connectors added before the two endpoints were merged.

## Architecture

| Component | Description |
|---|---|
| [worker/](worker/) | A Hono app on Cloudflare Workers, with Durable Objects for projects, dashboards, the scheduler, and MCP sessions, and a Workflow for provisioning. |
| [web/](web/) | Vue 3, Tailwind, and Reka UI admin panel and dashboard builder, served as Worker static assets. |
| [shared/](shared/) | Web Component widgets, the integration catalog, and automation blocks, used by both web and worker. |
| [plugin/](plugin/) | The Claude Code plugin. |
| [deploy/](deploy/) | The config behind the Deploy to Cloudflare button. |
| [scripts/](scripts/) | Build, version, and migration generators. |

### Storage

| Store | Holds |
|---|---|
| Project Durable Object (SQLite) | Latest variable state, a recent ring buffer, pending control writes, and the flush cursor |
| R2 | Telemetry history as NDJSON, partitioned by project and hour |
| D1 | Users, sessions, accounts, projects, variables, dashboards, tokens, automations, integrations, the audit log, and sign-in provider settings. Metadata only, never telemetry points |
| KV | Cached `/state` responses, JWKS, and OAuth clients and grants |
| Dashboard Durable Object | Per-dashboard subscriptions and hibernated WebSockets |
| Scheduler Durable Object | One alarm for the next schedule or sunset automation |

## Development

Prerequisites: [Bun](https://bun.sh) and, to deploy, a Cloudflare account.

```bash
bun install
bun run dev              # worker (wrangler dev)
bun run dev:web          # web (vite)
bun run typecheck
bun run build
bun run deploy:platform  # build and deploy the worker
```

The root `wrangler.toml` is for local development. Deploys from the Deploy to Cloudflare button use [deploy/wrangler.toml](deploy/wrangler.toml).

## Security

To report a vulnerability, see [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE) © Arjun Krishna
