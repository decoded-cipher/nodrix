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
| D1 | Users, sessions, accounts, projects, devices, dashboards, tokens, automations, integrations, audit log, OAuth provider config (metadata only — never any telemetry point) |
| KV | Cached `/state` responses |
| Dashboard DO | Per-dashboard subscription set + hibernated WebSockets |

## Authentication

[Better Auth](https://www.better-auth.com) handles sign-in. Email + password is
on by default; Google and GitHub OAuth can be enabled at runtime from
**Settings → Sign-in providers** (the owner enters a client ID + secret per
provider; the login page shows the corresponding buttons immediately).

First-time deployments hit a "Create owner account" page on first visit — the
first signup becomes role `owner`. After that, registration is closed (RBAC
invites land later). Sessions are cookie-based and persist 30 days; each
device is a separate session row, listed and revokable from **Users**.

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

On first visit, the app sends you to `/login` to create the owner account.
Sessions are cookie-based and signed with `BETTER_AUTH_SECRET` (a Workers
Secret — KMS-encrypted, separate from your D1 data).

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

The Deploy to Cloudflare wizard prompts for one secret during setup:

- **`BETTER_AUTH_SECRET`** — signs session cookies. Generate with
  `openssl rand -base64 32` and paste it into the wizard field. Stored as a
  KMS-encrypted Workers Secret, never plaintext.

Then visit your worker URL → create the owner account. That's it.

Optionally, **Settings → Sign-in providers** lets the owner enable Google or
GitHub OAuth: paste a client ID + secret from the provider's console (the
form displays the callback URL to register). The login page picks the buttons
up immediately — no redeploy.
