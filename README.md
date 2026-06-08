# nodrix

**The IoT platform Cloudflare didn't build.** Point your hardware at one endpoint over HTTPS or WebSocket, watch variables appear on their own, build realtime drag-and-drop dashboards, automate, and read it all back through a clean API — entirely on infrastructure you own. nodrix is single-tenant and open source: it deploys into _your_ Cloudflare account on Workers, Durable Objects, D1, and R2.

## Features

- 📡 **Telemetry over HTTPS or WebSocket** — hardware POSTs JSON to a project; variables auto-create on first sight. No schema to define, no MQTT broker to run.
- 📊 **Realtime dashboards** — a drag-and-drop widget grid streams updates over hibernating WebSockets; share any dashboard read-only by public link.
- 🧩 **Embeddable widgets** — every widget is a framework-agnostic Web Component you can lift straight into your own app.
- 🎮 **Two-way control** — toggles, sliders, color pickers, and buttons write values back to hardware via short polls or a control socket.
- 🤖 **Visual automations** — variable, schedule, sunrise/sunset, and event triggers run conditions and actions: webhooks, code snippets, and service integrations.
- 🔌 **Integrations** — fan out to HTTP, email, and chat (Slack, Telegram, Discord, and more).
- 📖 **Clean read API** — latest state, time-series, and variable listings behind one token.
- 🧠 **Native MCP server** — an owner-gated Model Context Protocol endpoint with a Claude connector for AI clients (off by default).
- 👥 **Multi-user** — owner / admin / member roles, email invites, and social sign-in (Google, GitHub).
- 📝 **Audit log** — every privileged action recorded and paginated in the UI.

## Quick start

1. **Deploy** to your Cloudflare account — [one click](https://nodrix.live), or `bun run deploy:platform` from a clone.
2. **Create the owner account** — the first visit prompts a "Create owner account" page; the first signup becomes `owner`.
3. **Create a project** and mint a project token from the dashboard.
4. **Send telemetry** — variables are created the moment data arrives:

   ```bash
   curl -X POST https://<your-worker>/v1/telemetry \
     -H "Authorization: Bearer $NODRIX_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"metrics":{"temperature":23.4,"humidity":61}}'
   ```

5. **Read it back:**

   ```bash
   curl https://<your-worker>/v1/projects/<project>/state \
     -H "Authorization: Bearer $NODRIX_TOKEN"
   ```

## Architecture

- **Worker** ([worker/](worker/)) — a single Hono app. Durable Objects for Project, Dashboard, Scheduler, and the MCP agent; one Workflow for provisioning; D1 (metadata), R2 (telemetry history), KV (read cache + JWKS).
- **Web** ([web/](web/)) — Vue 3 + Tailwind + Reka UI admin panel and drag-and-drop dashboard builder, built and served as Worker static assets.
- **Shared** ([shared/](shared/)) — framework-agnostic Web Component widgets, the integration catalog, and automation blocks, consumed by both web and worker so there is a single source of truth.
- **Deploy** ([deploy/](deploy/)) — the small config carrier behind the one-click Deploy to Cloudflare.

```
worker/   Cloudflare Worker — API, Durable Objects, Workflow
web/      Vue 3 admin panel + dashboard builder
shared/   Web Component widgets, integration catalog, automation blocks
deploy/   One-click Deploy to Cloudflare config
scripts/  Build, version, and migration generators
```

## Storage

| Store | Holds |
|---|---|
| Project DO (SQLite) | Latest variable state, recent ring buffer, pending control writes, flush cursor |
| R2 | Cold telemetry history (NDJSON, partitioned by project + hour) |
| D1 | Users, sessions, accounts, projects, variables, dashboards, tokens, automations, integrations, audit log, OAuth provider config (metadata only — never any telemetry point) |
| KV | Cached `/state` responses and JWKS |
| Dashboard DO | Per-dashboard subscriptions + hibernated WebSockets |
| Scheduler DO | One alarm at the next schedule/sunset automation fire time |

## Authentication

[Better Auth](https://www.better-auth.com) handles sign-in. Email + password is on by default; Google and GitHub OAuth can be enabled at runtime from **Settings → Sign-in providers** (the owner enters a client ID + secret per provider, and the login page shows the matching buttons immediately).

The first signup on a fresh deployment becomes `owner`. After that, registration is closed: the owner invites people from **Users**, each with an owner / admin / member role. Sessions are cookie-based and persist 30 days; each device is a separate session, listed and revokable from **Users**.

## Development

nodrix uses [Bun](https://bun.sh).

```bash
bun install
bun run dev              # worker (wrangler dev)
bun run dev:web          # web (vite)
bun run typecheck
bun run build
bun run deploy:platform  # build + deploy the worker
```

## Links

- **Site** — https://nodrix.live
- **Changelog** — https://nodrix.live/changelog
- **Roadmap** — https://nodrix.live/roadmap

## License

[MIT](LICENSE) © Arjun Krishna
