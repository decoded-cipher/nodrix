-- nodrix D1 schema — single baseline migration.
--
-- METADATA ONLY. No telemetry point ever lives here (telemetry is R2 + the
-- Project DO). nodrix is pre-alpha with no cross-commit migration path: instances
-- are wiped and recreated from this file. For future changes, add a new
-- NNNN_*.sql alongside this one — the auto-migrator (db/auto-migrate.ts) applies
-- anything not yet recorded in d1_migrations.

-- Users: identity record. Bootstrap user is role='owner'. Authentication
-- credentials live in `accounts` (Better Auth); this table only holds profile.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 1,    -- nodrix has no email-verify flow; column kept only because Better Auth requires it
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

-- Variables: project-scoped data points. `key` is the telemetry JSON field name,
-- auto-created on first telemetry write. Minimal by design — no type/permission/
-- bounds. Every variable is read+write.
CREATE TABLE IF NOT EXISTS project_variables (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,                     -- telemetry JSON field name, e.g. 'pm25'
  name        TEXT,                              -- display name (optional)
  unit        TEXT,                              -- optional
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_seen   INTEGER                            -- last telemetry timestamp (unix seconds)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_variables_key
  ON project_variables(project_id, key);

-- Project tokens: hardware credential. Project-scoped; used for telemetry ingest
-- + control poll. SHA-256(token) at rest; never stored plaintext.
CREATE TABLE IF NOT EXISTS project_tokens (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT,
  hash         TEXT NOT NULL UNIQUE,            -- SHA-256(token) hex
  created_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_project_tokens_project ON project_tokens(project_id);

-- User/API tokens: read or admin API access for humans/integrations.
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
  layout      TEXT NOT NULL,                                   -- JSON; see web/src/builder
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
                    ('variable','scene','schedule','sunset_sunrise','event')),
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

-- Integrations: reusable connectors (webhook, Slack, HTTP service, ...).
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
  archived_at INTEGER,
  last_run_at     INTEGER,                                     -- last delivery attempt
  last_run_status TEXT CHECK (last_run_status IN ('ok','error','skipped')),
  last_error      TEXT
);
CREATE INDEX IF NOT EXISTS idx_integrations_project ON integrations(project_id);

-- Audit log: append-only trail of privileged writes + automation runs.
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  user_id     TEXT REFERENCES users(id)   ON DELETE SET NULL,
  action      TEXT NOT NULL,                                   -- e.g. 'automation.run'
  target_type TEXT,
  target_id   TEXT,
  metadata    TEXT,                                            -- JSON
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target  ON audit_log(target_type, target_id);

-- Deployment-wide settings (generic K/V).
CREATE TABLE IF NOT EXISTS deployment_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
