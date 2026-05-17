-- Initial schema. Mirrors src/db/schema.sql so `wrangler d1 migrations apply`
-- and the runtime migrate() helper end in the same state.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,
  email      TEXT NOT NULL UNIQUE,
  role       TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS project_members (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS devices (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen  INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devices_project ON devices(project_id);

CREATE TABLE IF NOT EXISTS device_tokens (
  id         TEXT PRIMARY KEY,
  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  hash       TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id);

CREATE TABLE IF NOT EXISTS user_tokens (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,
  scope        TEXT NOT NULL CHECK (scope IN ('read','admin')),
  hash         TEXT NOT NULL UNIQUE,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_user_tokens_project ON user_tokens(project_id);

CREATE TABLE IF NOT EXISTS dashboards (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  layout     TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dashboards_project ON dashboards(project_id);
