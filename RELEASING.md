# Releasing

The runtime version is the root [`package.json`](package.json) `version` field —
the single source of truth. `scripts/gen-version.ts` reads it at build time and
writes `worker/src/version.gen.ts` (gitignored) with three values:

- `VERSION` — semver, from root `package.json`
- `COMMIT` — git HEAD locally, or the CI commit SHA on Cloudflare Workers Builds
- `BUILT_AT` — unix seconds at build time

`worker/src/version.gen.ts` is **never committed**. It's regenerated on
`bun install` (root `postinstall`) and as the first step of `bun run build`, so
fresh clones and CI both produce a current file. The Settings → version endpoint
([`worker/src/admin/version.ts`](worker/src/admin/version.ts)) surfaces these.

> The `version` fields in `worker/`, `web/`, and `promo/` package.json are
> cosmetic — `gen-version.ts` only reads root. Bump root.

## Cutting a release

Deployment is **pull-based**, not pushed from a terminal. Cloudflare Workers
Builds always builds upstream `master` HEAD via
[`build-from-upstream.sh`](scripts/build-from-upstream.sh), so a release is just
moving `master` forward on GitHub:

```sh
# 1. Bump root package.json "version" (pre-1.0: breaking changes may ride a
#    minor bump), e.g. 0.1.0 -> 0.2.0
# 2. Commit + tag + push to GitHub
git commit -am "release: v0.2.0"
git tag v0.2.0
git push && git push --tags
```

Each instance picks up the new version and commit on its **next Cloudflare
build** — triggered by the owner, not by you:

- New installs: the **Deploy to Cloudflare** button.
- Existing installs: **Retry build** (or any new build) in the Cloudflare
  dashboard.

The version endpoint compares the deployed `COMMIT` against upstream `master`
HEAD, so instances show "behind" until their owner re-runs the build.

Tags don't affect what's deployed — Cloudflare builds `master` HEAD through a
shallow (`--depth=1`) clone that doesn't fetch tags. Tags are for GitHub release
tracking only.
