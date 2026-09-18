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
- 🧠 **Native MCP server** — read telemetry and control hardware from an AI assistant, on devices you are not physically next to. Owner-gated and off by default; see [AI assistants (MCP)](#ai-assistants-mcp).
- 👥 **Multi-user** — owner / admin / member roles, email invites, and social sign-in (Google, GitHub).
- 📝 **Audit log** — every privileged action recorded and paginated in the UI.
- 🔧 **Over-the-air updates** — compile with your own toolchain, upload the image, assign it to a board; it pulls the update on its next check.

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

## Updating hardware over the air

Compile with the toolchain you already use, upload the image, and any board in the project can take it on its next check — no USB, no cable, no physical access.

1. **Version the sketch.** `Nodrix.setFirmwareVersion("1.2.0")` — the board reports this back, and it is how nodrix knows the update landed. Needs the [Nodrix library](https://github.com/decoded-cipher/nodrix-sdk) at 0.2.0 or newer.
2. **Compile.** Arduino IDE: **Sketch → Export Compiled Binary**, then take `<sketch>.ino.bin` from `build/<board>/`. `arduino-cli compile --output-dir build` and PlatformIO's `.pio/build/<env>/firmware.bin` work the same way. Upload the app image, not `.ino.merged.bin` or `.ino.bootloader.bin` — nodrix rejects those, since a board flashed with one over the air would not boot.
3. **Upload** it on **Devices → Firmware** with the same version string, then **assign** it to a board on **Devices**.

A board on the control socket is told immediately; one on HTTP finds it at its next check or on reboot. The board reports the new version when it comes back up, which is what marks the update done. If it keeps pulling the image without ever reporting the new version — nearly always the version in the sketch not matching the one on the upload — nodrix stops offering it after a few attempts and says so, instead of leaving the board reinstalling forever. Assigning the firmware again clears that and retries.

The first flash of a board is still over USB, with the Arduino IDE or `esptool`, and it needs a partition scheme with OTA slots (the ESP32 default has them). Every image you ship over the air has to include the nodrix SDK, or the board will have no way to receive the next one.

## AI assistants (MCP)

nodrix ships a native [Model Context Protocol](https://modelcontextprotocol.io) server, so an assistant can read a project's telemetry and — once you allow it — act on the hardware. Because devices report to your deployment rather than to your laptop, the board does not need to be plugged into the machine running the assistant; it can be in another building.

Two endpoints, both Streamable HTTP:

| Endpoint | Auth | For |
|---|---|---|
| `/v1/mcp` | Bearer token | CLI and IDE clients |
| `/v1/mcp/oauth` | OAuth | claude.ai-style connectors |

**Both are off by default.** The owner flips them in **Settings → More**:

- `mcp_enabled` — the master switch. While it is off, `/v1/mcp` returns **404**, so a disabled server looks absent rather than merely forbidden.
- `mcp_write_enabled` — gates the management and control tools. Until it is on, even an admin-scope token gets read-only tools, so an assistant cannot command hardware by default.

**12 read tools** — `list_projects`, `list_variables`, `get_state`, `get_series`, `list_dashboards`, `get_dashboard`, `list_widget_types`, `list_widgets`, `list_block_types`, `list_integration_kinds`, `list_automations`, `list_integrations`.

**16 write tools** — creating and updating projects, variables, dashboards, widgets, automations, and integrations, plus `set_variable` (how an assistant turns a relay on), `run_automation`, `emit_event`, and `test_integration`.

**There are no delete tools, by design.** Every tool resolves its target project through the token's scope before it runs, so it cannot reach a project the token cannot.

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
