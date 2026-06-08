#!/usr/bin/env bash
#
# Build pipeline that deploys upstream source, not the local clone's code.
# Invoked by deploy/wrangler.toml's [build] command via the bootstrap
# one-liner that curls this file from upstream master.
#
# Why: the Deploy to Cloudflare button creates a clone of this repo's deploy/
# subdir in the user's account. Without this script, that clone would be the
# source of truth — meaning code changes in upstream never reach them. With
# this script, every deploy:
#
#   1. Preserves the user's wrangler.toml (which has their resource IDs,
#      filled by the Deploy button on day 1 and never changed since).
#   2. Replaces every other file with the upstream source's contents.
#   3. Runs upstream's build pipeline.
#
# Result: the user's clone is functionally a config carrier. Code = upstream.
#
# Which upstream ref is pulled depends on NODRIX_DEPLOY_CHANNEL:
#   - release (default): the latest published GitHub release. Production.
#   - edge:              default-branch HEAD. For the maintainer's dev instance.
#
# Local development is unaffected: this script only runs when
# WORKERS_CI_COMMIT_SHA is set, which Cloudflare Workers Builds populates
# in CI. Locally, `bun run build` calls the workspace scripts directly and
# doesn't touch this file.

set -euo pipefail

UPSTREAM_REPO="${NODRIX_UPSTREAM_REPO:-decoded-cipher/nodrix}"
DEPLOY_CHANNEL="${NODRIX_DEPLOY_CHANNEL:-release}"
UPSTREAM_DIR="/tmp/nodrix-upstream"
WRANGLER_BACKUP="/tmp/nodrix-wrangler.toml"

if [ -z "${WORKERS_CI_COMMIT_SHA:-}" ]; then
  echo "[build-from-upstream] not in Workers Builds CI — running local build chain"
  bun install
  bun scripts/gen-version.ts
  bun scripts/gen-migrations.ts
  bun run --filter @nodrix/web build
  exit 0
fi

echo "[build-from-upstream] CI build — pulling upstream ${UPSTREAM_REPO} (${DEPLOY_CHANNEL} channel)"

# 1. Preserve user's wrangler.toml.
if [ ! -f wrangler.toml ]; then
  echo "[build-from-upstream] no wrangler.toml in cwd — refusing to proceed" >&2
  exit 1
fi
cp wrangler.toml "${WRANGLER_BACKUP}"

# 2. Clone the upstream ref into a temp dir, capture its commit SHA, then drop
#    upstream's own .git directory — we never want to overlay upstream's git
#    history into the deployment's git tree (and git's pack files are chmod
#    444, so a second-pass cp would fail with EACCES, which is exactly what
#    happens because Workers Builds runs the [build] command twice: once for
#    `npm run build` and again for the subsequent `wrangler deploy`).
#
#    The ref is the latest published release (release channel) or the
#    default-branch HEAD (edge channel). The SHA capture has to happen BEFORE
#    the .git rm.
rm -rf "${UPSTREAM_DIR}"
if [ "${DEPLOY_CHANNEL}" = "edge" ]; then
  echo "[build-from-upstream] edge channel — cloning default-branch HEAD"
  git clone --depth=1 "https://github.com/${UPSTREAM_REPO}.git" "${UPSTREAM_DIR}"
else
  # Latest published release tag (excludes drafts/prereleases). grep/sed keeps
  # this jq-free; the build image isn't guaranteed to have jq.
  RELEASE_TAG=$(curl -fsSL -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/${UPSTREAM_REPO}/releases/latest" \
    | grep -m1 '"tag_name"' | sed -E 's/.*"tag_name":[[:space:]]*"([^"]+)".*/\1/')
  if [ -z "${RELEASE_TAG}" ]; then
    echo "[build-from-upstream] no published release for ${UPSTREAM_REPO} — publish one, or set NODRIX_DEPLOY_CHANNEL=edge to track the default branch" >&2
    exit 1
  fi
  echo "[build-from-upstream] release channel — latest release: ${RELEASE_TAG}"
  git clone --depth=1 --branch "${RELEASE_TAG}" "https://github.com/${UPSTREAM_REPO}.git" "${UPSTREAM_DIR}"
fi
UPSTREAM_SHA=$(cd "${UPSTREAM_DIR}" && git rev-parse HEAD)
export WORKERS_CI_COMMIT_SHA="${UPSTREAM_SHA}"
echo "[build-from-upstream] upstream commit: ${UPSTREAM_SHA}"
rm -rf "${UPSTREAM_DIR}/.git"

# 3. Overlay upstream onto the local working tree IN-PLACE. Critical: do NOT
#    rm-rf and recreate directories. The outer `bun run --filter @nodrix/worker
#    build` process is holding a CWD inside worker/, and the wrangler subprocess
#    it spawned is what's running THIS script. If we wipe worker/ and recreate
#    it, those processes end up with a CWD pointing to a deleted inode — wrangler
#    silently hangs on its next filesystem op. `cp -Rf src/. dst` overwrites
#    files in place (including read-only ones via -f) without touching the
#    parent inode.
cp -Rf "${UPSTREAM_DIR}"/. .

# 3b. Mirror upstream DELETIONS. `cp -Rf` only adds/overwrites, so a file the
#     upstream renamed or deleted (e.g. a removed Vue page) lingers in an existing
#     deployment's tree — and since the build typechecks the whole src tree
#     (vue-tsc), an orphan referencing now-removed code breaks the build. Delete
#     any source file upstream no longer has. We remove individual FILES only,
#     never a directory, so the worker/ CWD inode the parent process holds stays
#     valid.
#
#     `internal/` is deliberately NOT in this list: it's a git submodule
#     (promo + test-clients + dev docs) that the --depth=1 upstream clone does
#     not recurse, so it never carries deploy-relevant source. The worker+web
#     build chain doesn't touch it.
for dir in web worker scripts; do
  [ -d "$dir" ] || continue
  find "$dir" -type f \
    -not -path '*/node_modules/*' -not -path '*/dist/*' \
    -not -path '*/.wrangler/*' -not -path '*/.astro/*' \
    -print | while IFS= read -r f; do
      [ -e "${UPSTREAM_DIR}/${f}" ] || rm -f "$f"
    done
done

# 4. Restore user's wrangler.toml in case upstream had its own (which it does).
cp "${WRANGLER_BACKUP}" wrangler.toml

# 4b. Drop the nested deploy/ that the overlay just brought in. The clone root
#     IS the deploy carrier; upstream's own deploy/ dir is dead weight here and
#     would otherwise sit one level deep in the deployed tree. Safe to rm — it's
#     not the CWD inode any parent process holds (that's worker/).
rm -rf ./deploy

# 5. Run the standard build chain on the now-upstream source. Invoke the
#    gen scripts directly (not via `bun run --filter nodrix`) — bun's filter
#    only matches workspace members, and "nodrix" is the workspace root.
bun install
bun scripts/gen-version.ts
bun scripts/gen-migrations.ts
bun run --filter @nodrix/web build

echo "[build-from-upstream] done"
