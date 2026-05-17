-- D1 schema for nodrix (v2).
-- METADATA ONLY. No telemetry point ever lives here.
-- See plan §3 + invariant #1.
--
-- Keep this file, src/db/migrate.ts (STATEMENTS), and the migrations/ folder
-- aligned. Existing deployments diff via migrations/0002_schema_v2.sql; fresh
-- deployments boot directly into this state.

-- Users: identity record. Bootstrap user is role='owner'. Authentication
-- credentials live in `accounts` (Better Auth); this table only holds profile.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  name           TEXT,                                      -- Better Auth required
  image          TEXT,
  role           TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),
  first_name     TEXT,
  last_name      TEXT,
  last_login_at  INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL
);

-- accounts: Better Auth credential store. provider_id='credential' for
-- email/password (password column has the hash); 'google'/'github' for OAuth.
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
  password                 TEXT,                            -- hashed; email/password only
  created_at               INTEGER NOT NULL,
  updated_at               INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_accounts_user     ON accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider_id, account_id);

-- sessions: one row per signed-in device.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,                         -- cookie value
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  ip_address  TEXT,
  user_agent  TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token);

-- verifications: short-lived tokens for password reset / email verify.
CREATE TABLE IF NOT EXISTS verifications (
  id          TEXT PRIMARY KEY,
  identifier  TEXT NOT NULL,
  value       TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON verifications(identifier);

-- auth_providers: runtime OAuth config. Editable from the Settings page; the
-- worker reads these rows when building the Better Auth instance per request.
CREATE TABLE IF NOT EXISTS auth_providers (
  kind          TEXT PRIMARY KEY CHECK (kind IN ('google','github')),
  client_id     TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  icon        TEXT,
  color       TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER
);

-- Forward-compat for RBAC invites.
CREATE TABLE IF NOT EXISTS project_members (
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),
  added_at   INTEGER NOT NULL,
  added_by   TEXT REFERENCES users(id),
  PRIMARY KEY (user_id, project_id)
);

CREATE TABLE IF NOT EXISTS devices (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_seen   INTEGER,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_devices_project ON devices(project_id);

CREATE TABLE IF NOT EXISTS device_tokens (
  id           TEXT PRIMARY KEY,
  device_id    TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  name         TEXT,
  hash         TEXT NOT NULL UNIQUE,            -- SHA-256(token) hex
  created_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id);

CREATE TABLE IF NOT EXISTS user_tokens (
  id           TEXT PRIMARY KEY,
  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE, -- NULL = all-projects scope
  scope        TEXT NOT NULL CHECK (scope IN ('read','admin')),
  name         TEXT,                                           -- label, e.g. "Grafana"
  hash         TEXT NOT NULL UNIQUE,
  created_by   TEXT NOT NULL REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER,                                        -- NULL = never
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_user_tokens_project ON user_tokens(project_id);

CREATE TABLE IF NOT EXISTS dashboards (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  layout      TEXT NOT NULL,                                   -- JSON; see web/src/builder/layout-schema.ts
  visibility  TEXT NOT NULL DEFAULT 'private'
              CHECK (visibility IN ('private','public')),
  share_token TEXT,                                            -- public share URL secret
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dashboards_project ON dashboards(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboards_share_token
  ON dashboards(share_token) WHERE share_token IS NOT NULL;

-- Automations: trigger + ordered action list.
CREATE TABLE IF NOT EXISTS automations (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  enabled         INTEGER NOT NULL DEFAULT 1,                  -- 0/1
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN
                    ('schedule','device_state','sunset_sunrise','event','scene')),
  trigger_config  TEXT NOT NULL,                               -- JSON
  actions         TEXT NOT NULL,                               -- JSON ordered list
  created_by      TEXT REFERENCES users(id),
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  last_run_at     INTEGER,
  last_run_status TEXT CHECK (last_run_status IN ('ok','error','skipped')),
  last_error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id);
CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled) WHERE enabled = 1;

-- Integrations: reusable connectors (webhooks, code blocks, Slack, etc.).
CREATE TABLE IF NOT EXISTS integrations (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN
                ('webhook','code_block','slack','email','mqtt','http_service')),
  config      TEXT NOT NULL,                                   -- JSON, kind-specific
  enabled     INTEGER NOT NULL DEFAULT 1,
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_integrations_project ON integrations(project_id);

-- Audit log: append-only trail of writes + automation runs.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  user_id     TEXT REFERENCES users(id)   ON DELETE SET NULL,
  action      TEXT NOT NULL,                                   -- e.g. 'device.create'
  target_type TEXT,
  target_id   TEXT,
  metadata    TEXT,                                            -- JSON
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target  ON audit_log(target_type, target_id);
