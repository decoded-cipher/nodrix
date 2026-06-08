# nodrix — deploy shim

This repo is a thin **deploy carrier** for [nodrix](https://github.com/decoded-cipher/nodrix),
created by the *Deploy to Cloudflare* button. It is not the application source.

- `wrangler.toml` holds your Cloudflare resource IDs (D1, R2, KV, Durable Objects)
  and the build command.
- On every build, the bootstrap in `wrangler.toml` pulls the real nodrix source
  (the latest release) over this clone and deploys it. Your `wrangler.toml` is
  preserved across builds.

You don't need to edit anything here. Manage your deployment — re-run a build to
update, view logs, change variables — from the **Cloudflare dashboard**
(Workers → your `nodrix` service).

To stay on the latest version: open the Cloudflare dashboard and **Retry build**
(or do it from **Settings → Version & updates** inside nodrix, which links you
there). New nodrix releases are picked up on your next build.
