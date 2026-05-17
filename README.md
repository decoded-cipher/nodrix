# nodrix

A Cloudflare-native IoT platform. Devices POST telemetry over HTTPS, poll for commands, and stream realtime data to a drag-and-drop dashboard — all running in your own Cloudflare account.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/decoded-cipher/nodrix)

## Architecture

- **Worker** (`worker/`) — single Hono app, two Durable Object classes (Device, Dashboard), one Workflow (provisioning), D1 (metadata), R2 (telemetry history), KV (read cache + JWKS).
- **Web** (`web/`) — Vue 3 + Tailwind + Reka UI admin panel and drag-and-drop dashboard builder. Built and served as Worker static assets.
- **Promo site** (`promo/`) — Astro static site with the Deploy-to-Cloudflare button. Deploys independently to Cloudflare Pages.

## Storage allocation

| Store | Holds |
|---|---|
| Device DO (SQLite) | Latest state, recent ring buffer, pending commands, flush cursor |
| R2 | Cold telemetry history (NDJSON, partitioned by device + hour) |
| D1 | Users, projects, devices, dashboards, tokens, automations, integrations, audit log (metadata only — never any telemetry point) |
| KV | Cached `/state` responses; cached Access JWKS |
| Dashboard DO | Per-dashboard subscription set + hibernated WebSockets |

## Local dev

```sh
bun install

# Build the SPA + worker bundle once so the Worker can serve it via ASSETS.
bun run build

# Start the Worker (wrangler dev creates local D1/R2/KV in .wrangler/).
bun run dev

# Optional: hot-reload the SPA separately (Vite proxies /v1 + /ws to :8787).
bun run dev:web

# Promo site (separate Pages app):
bun run dev:promo
```

In local dev the worker has no CF Access — sign-in uses an `X-Dev-Email` header.
The SPA picks it up from `localStorage` (set via the `/setup` page).

## Smoke test

End-to-end verification of the §11 loop. Worker must be running.

```sh
bun run dev         # terminal 1
bun run smoke       # terminal 2
```

Drives bootstrap → project → device → telemetry → read API → dashboard →
WebSocket snapshot + update → command round-trip → R2 flush. Exits non-zero
on any failure.

## Simulated devices

`examples/sim-devices/` is a small Node script that mints a device token and
pushes synthetic telemetry — useful for exercising dashboards without real
hardware.

```sh
cd examples/sim-devices
npm install
cp .env.example .env   # set NODRIX_ENDPOINT + per-device tokens
npm start
```

## Deploy

```sh
bun run deploy:platform   # builds web + deploys the Worker
bun run deploy:promo  # deploys the promo site to Cloudflare Pages
```

## Post-deploy setup

After the Deploy button finishes, you need to gate the Worker behind Cloudflare Access:

1. Cloudflare Dashboard → **Zero Trust** → **Access** → **Applications** → **Add application**.
2. Type: **Self-hosted**. Domain: your worker's hostname.
3. Policy: whoever you want to grant access to (email, IdP, etc.).
4. Copy the **Application Audience (AUD) tag** into the Worker's `CF_ACCESS_AUD` env var.
5. Set `CF_ACCESS_TEAM_DOMAIN` to your team domain (e.g. `your-team.cloudflareaccess.com`).
6. Visit your worker URL — first login provisions you as the owner and creates a default project.
