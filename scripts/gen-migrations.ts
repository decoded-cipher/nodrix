// Bundles worker/src/db/migrations/*.sql into a TS array the Worker can
// import. The Worker can't read from the filesystem at runtime, so this is
// how the auto-migrator gets at the source SQL.
//
// Same pattern as scripts/gen-version.ts: committed defaults exist for
// fresh checkouts; every build overwrites with the current set.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const srcDir = join(repoRoot, 'worker', 'src', 'db', 'migrations');
const outPath = join(repoRoot, 'worker', 'src', 'db', 'migrations.gen.ts');

// Splits a SQL file into individual statements. Handles:
//   - `--` line comments (stripped)
//   - `'...'` and `"..."` strings (semicolons inside are not boundaries)
//   - `''` and `""` escaped quotes inside strings
// Block comments aren't currently used in our migrations — easy to add if
// they ever are.
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let buf = '';
  let i = 0;
  const n = sql.length;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];

    if (c === '-' && next === '-') {
      while (i < n && sql[i] !== '\n') i++;
      continue;
    }

    if (c === "'" || c === '"') {
      const q = c;
      buf += c;
      i++;
      while (i < n) {
        if (sql[i] === q && sql[i + 1] === q) {
          buf += q + q;
          i += 2;
          continue;
        }
        buf += sql[i];
        if (sql[i] === q) { i++; break; }
        i++;
      }
      continue;
    }

    if (c === ';') {
      const trimmed = buf.trim();
      if (trimmed) out.push(trimmed);
      buf = '';
      i++;
      continue;
    }

    buf += c;
    i++;
  }
  const trailing = buf.trim();
  if (trailing) out.push(trailing);
  return out;
}

const files = readdirSync(srcDir).filter((f) => f.endsWith('.sql')).sort();

type Migration = { name: string; statements: string[] };
const migrations: Migration[] = files.map((f) => ({
  name: f.replace(/\.sql$/, ''),
  statements: splitStatements(readFileSync(join(srcDir, f), 'utf8')),
}));

const contents = `// AUTO-GENERATED at build time by scripts/gen-migrations.ts.
// Source: worker/src/db/migrations/*.sql. Do not edit by hand.

export type Migration = { name: string; statements: string[] };

export const MIGRATIONS: Migration[] = ${JSON.stringify(migrations, null, 2)};
`;

writeFileSync(outPath, contents, 'utf8');
const total = migrations.reduce((n, m) => n + m.statements.length, 0);
console.log(`wrote ${outPath}: ${migrations.length} migrations, ${total} statements`);
