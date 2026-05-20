# nodrix

![status](https://img.shields.io/badge/status-alpha-red) ![not production ready](https://img.shields.io/badge/not_production_ready-do_not_deploy-red)

**The IoT platform Cloudflare didn't build.** Hardware POSTs telemetry over HTTPS to a project's variables, polls for control writes, and streams realtime data to a drag-and-drop dashboard — all running in your own Cloudflare account on Workers, D1, R2, and Durable Objects.

> [!CAUTION]
> ## 🚧 Early development — do not deploy 🚧
>
> **nodrix is pre-alpha and changing daily.** APIs, database schemas, and on-disk data formats break between commits without migration paths. There is no upgrade story yet.
>
> - ❌ No stable releases
> - ❌ No migrations between commits
> - ❌ No security review
> - ❌ Not yet recommended for any account you care about
>
> Setup, deploy, and contribution docs will land once the surface stabilizes. Until then, treat the repo as **read-only source for the curious**.
>
> ⭐ **Star** and 👀 **Watch** the repo to get notified the moment it's ready to deploy.

---

## ✨ Features

- 📡 **HTTPS telemetry ingress** — hardware POSTs JSON to a project's variables (auto-created on first sight); no MQTT broker to operate.
- 📊 **Realtime dashboards** — drag-and-drop widget grid streams updates over hibernating WebSockets.
- 🎮 **Control** — dashboard widgets write variable values that hardware picks up via short polls.
- 🤖 **Automations** — trigger webhooks, code snippets, or service integrations on telemetry events.
- 🗂️ **Multi-project** — group variables, dashboards, and members by project.
- 🔑 **Auth** — email + password out of the box; optional Google / GitHub OAuth toggled at runtime.
- 📝 **Audit log** — every privileged action recorded and paginated in the UI.

## 🏗️ Architecture

- **Worker** ([worker/](worker/)) — single Hono app, three Durable Object classes (Project, Dashboard, Scheduler), one Workflow (provisioning), D1 (metadata), R2 (telemetry history), KV (read cache + JWKS).
- **Web** ([web/](web/)) — Vue 3 + Tailwind + Reka UI admin panel and drag-and-drop dashboard builder. Built and served as Worker static assets.
- **Promo site** ([promo/](promo/)) — Astro static site. Deploys independently to Cloudflare Pages.

## 💾 Storage allocation

| Store | Holds |
|---|---|
| Project DO (SQLite) | Latest variable state, recent ring buffer, pending control writes, flush cursor |
| R2 | Cold telemetry history (NDJSON, partitioned by project + hour) |
| D1 | Users, sessions, accounts, projects, variables, dashboards, tokens, automations, integrations, audit log, OAuth provider config (metadata only — never any telemetry point) |
| KV | Cached `/state` responses |
| Dashboard DO | Per-dashboard subscription + hibernated WebSockets |
| Scheduler DO | One alarm at the next schedule/sunset automation fire time |

## 🔐 Authentication

[Better Auth](https://www.better-auth.com) handles sign-in. Email + password is on by default; Google and GitHub OAuth can be enabled at runtime from **Settings → Sign-in providers** (the owner enters a client ID + secret per provider; the login page shows the corresponding buttons immediately).

First-time deployments hit a "Create owner account" page on first visit — the first signup becomes role `owner`. After that, registration is closed (RBAC invites land later). Sessions are cookie-based and persist 30 days; each device is a separate session row, listed and revokable from **Users**.
