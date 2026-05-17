-- v4: switch from Cloudflare Access to Better Auth (email/password + OAuth).
--
-- DESTRUCTIVE: this migration wipes all user-scoped data. v0.0.0 only — do not
-- apply against any production deployment that holds real telemetry/devices.
-- The auth model changed: existing users had no password (CF Access was the
-- identity broker), so they cannot transition cleanly; the simplest fix is to
-- re-bootstrap.
--
-- Schema additions:
--   users:              + name, image, email_verified (Better Auth required)
--   new: accounts       (Better Auth: per-provider credentials, incl. password)
--   new: sessions       (Better Auth: device-scoped session tokens)
--   new: verifications  (Better Auth: email verify / password reset tokens)
--   new: auth_providers (our settings UI: dynamic Google/GitHub OAuth config)

-- Wipe existing data in dependency order. project_members CASCADEs on users,
-- but explicit deletes keep the migration order obvious.
DELETE FROM audit_log;
DELETE FROM user_tokens;
DELETE FROM device_tokens;
DELETE FROM dashboards;
DELETE FROM automations;
DELETE FROM integrations;
DELETE FROM devices;
DELETE FROM project_members;
DELETE FROM projects;
DELETE FROM users;

-- Better Auth required columns on users.
ALTER TABLE users ADD COLUMN name           TEXT;
ALTER TABLE users ADD COLUMN image          TEXT;
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;

-- accounts: stores credentials per (provider, user). For email/password the
-- provider_id is 'credential' and `password` holds the Better Auth hash. For
-- OAuth it stores the access/refresh tokens.
CREATE TABLE IF NOT EXISTS accounts (
  id                       TEXT PRIMARY KEY,
  account_id               TEXT NOT NULL,
  provider_id              TEXT NOT NULL,
  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token             TEXT,
  refresh_token            TEXT,
  id_token                 TEXT,
  access_token_expires_at  INTEGER,
  refresh_token_expires_at INTEGER,
  scope                    TEXT,
  password                 TEXT,
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_user     ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider_id, account_id);

-- sessions: one row per signed-in device. `token` is what lives in the cookie
-- (Better Auth stores it directly; uniqueness is enforced for lookup).
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- verifications: opaque tokens for email verify / password reset / magic links.
CREATE TABLE IF NOT EXISTS verifications (
  id          TEXT PRIMARY KEY,
  identifier  TEXT NOT NULL,
  value       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON verifications(identifier);

-- auth_providers: runtime OAuth config. The owner edits this from Settings;
-- the worker rebuilds the Better Auth instance per request reading these rows.
CREATE TABLE IF NOT EXISTS auth_providers (
  kind          TEXT PRIMARY KEY CHECK (kind IN ('google','github')),
  client_id     TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);
