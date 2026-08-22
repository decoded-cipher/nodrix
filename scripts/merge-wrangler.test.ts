// Getting this wrong on a live deployment points it at resources it doesn't own,
// or renames the Worker. Run with `bun test scripts/merge-wrangler.test.ts`.

import { test, expect } from 'bun:test';
import { mergeWrangler } from './merge-wrangler';

// Renamed, on a custom domain, tracking a fork, and predating three template changes.
const DEPLOYMENT = `name = "home-iot"
main = "worker/src/index.ts"
compatibility_date = "2025-05-01"
compatibility_flags = ["nodejs_compat"]
account_id = "acc_123"
routes = [
  { pattern = "iot.example.com", custom_domain = true }
]

[[d1_databases]]
binding = "DB"
database_name = "home-iot-db"
database_id = "aaaa-bbbb-cccc"

[[kv_namespaces]]
binding = "KV"
id = "kv_deadbeef"

[[r2_buckets]]
binding = "R2"
bucket_name = "home-iot-telemetry"

[vars]
NODRIX_UPSTREAM_REPO = "someone/nodrix-fork"
`;

const TEMPLATE = `name = "nodrix"
main = "worker/src/index.ts"
compatibility_date = "2026-01-15"
compatibility_flags = ["nodejs_compat"]

[build]
command = "curl -fsSL https://example.invalid/build.sh | bash"

[[d1_databases]]
binding = "DB"
database_name = "nodrix"
database_id = "PLACEHOLDER_FILLED_BY_DEPLOY_OR_WRANGLER"
migrations_dir = "worker/src/platform/db/migrations"

[[kv_namespaces]]
binding = "KV"
id = "PLACEHOLDER_FILLED_BY_DEPLOY_OR_WRANGLER"

[[r2_buckets]]
binding = "R2"
bucket_name = "nodrix-telemetry"

[[durable_objects.bindings]]
name = "PROJECT_DO"
class_name = "ProjectDO"

[[migrations]]
tag = "v2"
new_sqlite_classes = ["DeviceDO"]

[vars]
NODRIX_UPSTREAM_REPO = "decoded-cipher/nodrix"
NODRIX_FEATURE_FLAG = "on"

[triggers]
crons = ["0 0 * * *"]
`;

const merged = mergeWrangler(DEPLOYMENT, TEMPLATE);

test('keeps the deployment worker name', () => {
  expect(merged).toContain('name = "home-iot"');
  expect(merged).not.toContain('name = "nodrix"');
});

test('keeps resource ids the deployment owns', () => {
  expect(merged).toContain('database_id = "aaaa-bbbb-cccc"');
  expect(merged).toContain('database_name = "home-iot-db"');
  expect(merged).toContain('id = "kv_deadbeef"');
  expect(merged).toContain('bucket_name = "home-iot-telemetry"');
  expect(merged).not.toContain('PLACEHOLDER');
});

test('keeps account and routes the template never declares', () => {
  expect(merged).toContain('account_id = "acc_123"');
  expect(merged).toContain('pattern = "iot.example.com"');
});

test('takes compatibility settings and build config from upstream', () => {
  expect(merged).toContain('compatibility_date = "2026-01-15"');
  expect(merged).toContain('https://example.invalid/build.sh');
});

test('takes new bindings, migrations and triggers from upstream', () => {
  expect(merged).toContain('class_name = "ProjectDO"');
  expect(merged).toContain('new_sqlite_classes = ["DeviceDO"]');
  expect(merged).toContain('crons = ["0 0 * * *"]');
  expect(merged).toContain('migrations_dir = "worker/src/platform/db/migrations"');
});

test('keeps an overridden var and adds one the deployment predates', () => {
  expect(merged).toContain('NODRIX_UPSTREAM_REPO = "someone/nodrix-fork"');
  expect(merged).toContain('NODRIX_FEATURE_FLAG = "on"');
});

test('is idempotent against its own output', () => {
  expect(mergeWrangler(merged, TEMPLATE)).toBe(merged);
});

test('a fresh deployment carrying only placeholders is left as the template', () => {
  const fresh = mergeWrangler(TEMPLATE, TEMPLATE);
  expect(fresh).toBe(TEMPLATE);
});
