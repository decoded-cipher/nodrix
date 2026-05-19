#!/usr/bin/env bash
#
# Build pipeline that always deploys upstream HEAD, not the local clone's
# code. Invoked by wrangler.toml's [build] command via the bootstrap
# one-liner that curls this file from upstream main.
#
# Why: the Deploy to Cloudflare button creates a clone of this repo in the
# user's account. Without this script, that clone would be the source of
# truth for the user's deployment — meaning code changes in upstream never
# reach them. With this script, every deploy:
#
#   1. Preserves the user's wrangler.toml (which has their resource IDs,
#      filled by the Deploy button on day 1 and never changed since).
#   2. Replaces every other file with upstream HEAD's contents.
#   3. Runs upstream's build pipeline.
#
# Result: the user's clone is functionally a config carrier. Code = upstream.
#
# Local development is unaffected: this script only runs when
# WORKERS_CI_COMMIT_SHA is set, which Cloudflare Workers Builds populates
# in CI. Locally, `bun run build` calls the workspace scripts directly and
# doesn't touch this file.

set -euo pipefail

UPSTREAM_REPO="${NODRIX_UPSTREAM_REPO:-decoded-cipher/nodrix}"
UPSTREAM_DIR="/tmp/nodrix-upstream"
WRANGLER_BACKUP="/tmp/nodrix-wrangler.toml"

if [ -z "${WORKERS_CI_COMMIT_SHA:-}" ]; then
  echo "[build-from-upstream] not in Workers Builds CI — running local build chain"
  bun install
  bun run --filter nodrix build:version
  bun run --filter nodrix build:migrations
  bun run --filter @nodrix/web build
  exit 0
fi

echo "[build-from-upstream] CI build — pulling upstream ${UPSTREAM_REPO}"

# 1. Preserve user's wrangler.toml.
if [ ! -f wrangler.toml ]; then
  echo "[build-from-upstream] no wrangler.toml in cwd — refusing to proceed" >&2
  exit 1
fi
cp wrangler.toml "${WRANGLER_BACKUP}"

# 2. Clone upstream HEAD into a temp dir.
rm -rf "${UPSTREAM_DIR}"
git clone --depth=1 "https://github.com/${UPSTREAM_REPO}.git" "${UPSTREAM_DIR}"

# 3. Wipe local working tree (except wrangler.toml and .git), copy upstream
#    in over the top. The find expression keeps wrangler.toml AND any dotfile
#    Cloudflare Workers Builds leaves around (e.g. .git for state, env files).
find . -mindepth 1 -maxdepth 1 \
  ! -name 'wrangler.toml' \
  ! -name '.git' \
  ! -name '.cf' \
  -exec rm -rf {} +
cp -R "${UPSTREAM_DIR}"/. .

# 4. Restore user's wrangler.toml in case upstream had its own committed.
cp "${WRANGLER_BACKUP}" wrangler.toml

# 5. Run the standard build chain on the now-upstream source.
bun install
bun run --filter nodrix build:version
bun run --filter nodrix build:migrations
bun run --filter @nodrix/web build

echo "[build-from-upstream] done"
