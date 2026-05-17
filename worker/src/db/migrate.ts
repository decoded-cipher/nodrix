import type { D1Database } from '@cloudflare/workers-types';

// Inline schema string. Kept in sync with src/db/schema.sql by hand.
// Split into individual statements because D1.prepare() takes one statement at a time.
//
// This path runs ONLY on fresh deployments (called from /v1/admin/me when the
// users table is empty/absent). Existing deployments are migrated via
// `wrangler d1 migrations apply` against the files in db/migrations/.
const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    role          TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),
    display_name  TEXT,
    avatar_url    TEXT,
    last_login_at INTEGER,
    created_at    INTEGER NOT NULL,
    updated_at    INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS projects (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    description TEXT,
    icon        TEXT,
    color       TEXT,
    created_by  TEXT REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    archived_at INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS project_members (
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    role       TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),
    added_at   INTEGER NOT NULL,
    added_by   TEXT REFERENCES users(id),
    PRIMARY KEY (user_id, project_id)
  )`,
  `CREATE TABLE IF NOT EXISTS devices (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    created_by  TEXT REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    last_seen   INTEGER,
    archived_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_devices_project ON devices(project_id)`,
  `CREATE TABLE IF NOT EXISTS device_tokens (
    id           TEXT PRIMARY KEY,
    device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    name         TEXT,
    hash         TEXT NOT NULL UNIQUE,
    created_by   TEXT REFERENCES users(id),
    created_at   INTEGER NOT NULL,
    last_used_at INTEGER,
    revoked_at   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id)`,
  `CREATE TABLE IF NOT EXISTS user_tokens (
    id           TEXT PRIMARY KEY,
    project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
    scope        TEXT NOT NULL CHECK (scope IN ('read','admin')),
    name         TEXT,
    hash         TEXT NOT NULL UNIQUE,
    created_by   TEXT NOT NULL REFERENCES users(id),
    created_at   INTEGER NOT NULL,
    expires_at   INTEGER,
    last_used_at INTEGER,
    revoked_at   INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_user_tokens_project ON user_tokens(project_id)`,
  `CREATE TABLE IF NOT EXISTS dashboards (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    description TEXT,
    layout      TEXT NOT NULL,
    visibility  TEXT NOT NULL DEFAULT 'private'
                CHECK (visibility IN ('private','public')),
    share_token TEXT,
    created_by  TEXT REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    archived_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_dashboards_project ON dashboards(project_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboards_share_token
     ON dashboards(share_token) WHERE share_token IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS automations (
    id              TEXT PRIMARY KEY,
    project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    enabled         INTEGER NOT NULL DEFAULT 1,
    trigger_type    TEXT NOT NULL CHECK (trigger_type IN
                      ('schedule','device_state','sunset_sunrise','event','scene')),
    trigger_config  TEXT NOT NULL,
    actions         TEXT NOT NULL,
    created_by      TEXT REFERENCES users(id),
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    last_run_at     INTEGER,
    last_run_status TEXT CHECK (last_run_status IN ('ok','error','skipped')),
    last_error      TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id)`,
  `CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled) WHERE enabled = 1`,
  `CREATE TABLE IF NOT EXISTS integrations (
    id          TEXT PRIMARY KEY,
    project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    kind        TEXT NOT NULL CHECK (kind IN
                  ('webhook','code_block','slack','email','mqtt','http_service')),
    config      TEXT NOT NULL,
    enabled     INTEGER NOT NULL DEFAULT 1,
    created_by  TEXT REFERENCES users(id),
    created_at  INTEGER NOT NULL,
    updated_at  INTEGER NOT NULL,
    archived_at INTEGER
  )`,
  `CREATE INDEX IF NOT EXISTS idx_integrations_project ON integrations(project_id)`,
  `CREATE TABLE IF NOT EXISTS audit_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
    user_id     TEXT REFERENCES users(id)   ON DELETE SET NULL,
    action      TEXT NOT NULL,
    target_type TEXT,
    target_id   TEXT,
    metadata    TEXT,
    created_at  INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_log_target ON audit_log(target_type, target_id)`,
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
