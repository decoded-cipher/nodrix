// Writes worker/src/version.gen.ts with the current build's identity.
//
// Runs as part of the build (see wrangler.toml's [build] command + root
// package.json scripts). The generated file is committed with sensible
// defaults so fresh clones typecheck; local builds + CI overwrite it.
//
// Sources, in priority order:
//   - commit:    WORKERS_CI_COMMIT_SHA  (set by Cloudflare Workers Builds)
//                CF_PAGES_COMMIT_SHA    (set on Pages-style builds, fallback)
//                git rev-parse HEAD     (local builds)
//                'unknown'              (anything else)
//   - built_at:  unix seconds at script execution time
//   - version:   root package.json `version` field

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const outPath = join(repoRoot, 'worker', 'src', 'version.gen.ts');

function readVersion(): string {
  const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
    version?: string;
  };
  return pkg.version ?? '0.0.0';
}

function readCommit(): string {
  const fromEnv = process.env['WORKERS_CI_COMMIT_SHA'] ?? process.env['CF_PAGES_COMMIT_SHA'];
  if (fromEnv) return fromEnv.trim();
  const r = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return 'unknown';
}

const version = readVersion();
const commit = readCommit();
const builtAt = Math.floor(Date.now() / 1000);

const contents = `// AUTO-GENERATED at build time by scripts/gen-version.ts.
// Local builds + Cloudflare Workers Builds overwrite this file. The committed
// defaults exist so fresh checkouts typecheck without running the script.

export const VERSION: string = ${JSON.stringify(version)};
export const COMMIT: string = ${JSON.stringify(commit)};
export const BUILT_AT: number = ${builtAt};
`;

writeFileSync(outPath, contents, 'utf8');
console.log(`wrote ${outPath}: ${version} @ ${commit.slice(0, 7)}`);
