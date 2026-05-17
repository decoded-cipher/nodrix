import type { D1Database } from '@cloudflare/workers-types';

// Inline schema string. Kept in sync with src/db/schema.sql by hand for v1.
// Split into individual statements because D1.prepare() takes one statement at a time.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id         TEXT PRIMARY KEY,
    email      TEXT NOT NULL UNIQUE,
    role       TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS project_members (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),
    PRIMARY KEY (user_id, project_id)
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_seen  INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_devices_project ON devices(project_id)`,
  `CREATE TABLE IF NOT EXISTS device_tokens (
    id         TEXT PRIMARY KEY,
    device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    hash       TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    revoked_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id)`,
  `CREATE TABLE IF NOT EXISTS user_tokens (
    id           TEXT PRIMARY KEY,
    project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
    scope        TEXT NOT NULL CHECK (scope IN ('read','admin')),
    hash         TEXT NOT NULL UNIQUE,
    created_by   TEXT NOT NULL REFERENCES users(id),
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_tokens_project ON user_tokens(project_id)`,
  `CREATE TABLE IF NOT EXISTS dashboards (
    id         TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    layout     TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dashboards_project ON dashboards(project_id)`,
];

// Idempotent: all statements use IF NOT EXISTS. Safe to call on every cold start
// but we only call it from /v1/admin/me when the users table is empty or absent.
export async function runMigrations(db: D1Database): Promise<void> {
  await db.batch(STATEMENTS.map((sql) => db.prepare(sql)));
}

// Probe: returns true if the users table exists and has at least one row.
export async function isBootstrapped(db: D1Database): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT 1 AS one FROM users LIMIT 1').first<{ one: number }>();
    return row !== null;
  } catch {
    // users table doesn't exist yet
    return false;
  }
}
