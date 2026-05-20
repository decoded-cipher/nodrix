// AUTO-GENERATED at build time by scripts/gen-migrations.ts.
// Source: worker/src/db/migrations/*.sql. Do not edit by hand.

export type Migration = { name: string; statements: string[] };

export const MIGRATIONS: Migration[] = [
  {
    "name": "0001_init",
    "statements": [
      "CREATE TABLE IF NOT EXISTS users (\n  id             TEXT PRIMARY KEY,\n  email          TEXT NOT NULL UNIQUE,\n  email_verified INTEGER NOT NULL DEFAULT 1,    \n  name           TEXT,                                      \n  image          TEXT,\n  role           TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),\n  first_name     TEXT,\n  last_name      TEXT,\n  last_login_at  INTEGER,\n  created_at     INTEGER NOT NULL,\n  updated_at     INTEGER NOT NULL\n)",
      "CREATE TABLE IF NOT EXISTS accounts (\n  id                       TEXT PRIMARY KEY,\n  account_id               TEXT NOT NULL,\n  provider_id              TEXT NOT NULL,\n  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  access_token             TEXT,\n  refresh_token            TEXT,\n  id_token                 TEXT,\n  access_token_expires_at  INTEGER,\n  refresh_token_expires_at INTEGER,\n  scope                    TEXT,\n  password                 TEXT,                            \n  created_at               INTEGER NOT NULL,\n  updated_at               INTEGER NOT NULL\n)",
      "CREATE INDEX IF NOT EXISTS idx_accounts_user     ON accounts(user_id)",
      "CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider_id, account_id)",
      "CREATE TABLE IF NOT EXISTS sessions (\n  id          TEXT PRIMARY KEY,\n  token       TEXT NOT NULL UNIQUE,                         \n  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  expires_at  INTEGER NOT NULL,\n  ip_address  TEXT,\n  user_agent  TEXT,\n  created_at  INTEGER NOT NULL,\n  updated_at  INTEGER NOT NULL\n)",
      "CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id)",
      "CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)",
      "CREATE TABLE IF NOT EXISTS verifications (\n  id          TEXT PRIMARY KEY,\n  identifier  TEXT NOT NULL,\n  value       TEXT NOT NULL,\n  expires_at  INTEGER NOT NULL,\n  created_at  INTEGER NOT NULL,\n  updated_at  INTEGER NOT NULL\n)",
      "CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON verifications(identifier)",
      "CREATE TABLE IF NOT EXISTS auth_providers (\n  kind          TEXT PRIMARY KEY CHECK (kind IN ('google','github')),\n  client_id     TEXT NOT NULL,\n  client_secret TEXT NOT NULL,\n  enabled       INTEGER NOT NULL DEFAULT 1,\n  created_at    INTEGER NOT NULL,\n  updated_at    INTEGER NOT NULL\n)",
      "CREATE TABLE IF NOT EXISTS projects (\n  id          TEXT PRIMARY KEY,\n  name        TEXT NOT NULL,\n  description TEXT,\n  icon        TEXT,\n  color       TEXT,\n  created_by  TEXT REFERENCES users(id),\n  created_at  INTEGER NOT NULL,\n  updated_at  INTEGER NOT NULL,\n  archived_at INTEGER\n)",
      "CREATE TABLE IF NOT EXISTS project_members (\n  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  role       TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),\n  added_at   INTEGER NOT NULL,\n  added_by   TEXT REFERENCES users(id),\n  PRIMARY KEY (user_id, project_id)\n)",
      "CREATE TABLE IF NOT EXISTS project_variables (\n  id          TEXT PRIMARY KEY,\n  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  key         TEXT NOT NULL,                     \n  name        TEXT,                              \n  unit        TEXT,                              \n  created_at  INTEGER NOT NULL,\n  updated_at  INTEGER NOT NULL,\n  last_seen   INTEGER                            \n)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_project_variables_key\n  ON project_variables(project_id, key)",
      "CREATE TABLE IF NOT EXISTS project_tokens (\n  id           TEXT PRIMARY KEY,\n  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  name         TEXT,\n  hash         TEXT NOT NULL UNIQUE,            \n  created_by   TEXT REFERENCES users(id),\n  created_at   INTEGER NOT NULL,\n  last_used_at INTEGER,\n  revoked_at   INTEGER\n)",
      "CREATE INDEX IF NOT EXISTS idx_project_tokens_project ON project_tokens(project_id)",
      "CREATE TABLE IF NOT EXISTS user_tokens (\n  id           TEXT PRIMARY KEY,\n  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE, \n  scope        TEXT NOT NULL CHECK (scope IN ('read','admin')),\n  name         TEXT,                                           \n  hash         TEXT NOT NULL UNIQUE,\n  created_by   TEXT NOT NULL REFERENCES users(id),\n  created_at   INTEGER NOT NULL,\n  expires_at   INTEGER,                                        \n  last_used_at INTEGER,\n  revoked_at   INTEGER\n)",
      "CREATE INDEX IF NOT EXISTS idx_user_tokens_project ON user_tokens(project_id)",
      "CREATE TABLE IF NOT EXISTS dashboards (\n  id          TEXT PRIMARY KEY,\n  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  name        TEXT NOT NULL,\n  description TEXT,\n  layout      TEXT NOT NULL,                                   \n  visibility  TEXT NOT NULL DEFAULT 'private'\n              CHECK (visibility IN ('private','public')),\n  share_token TEXT,                                            \n  created_by  TEXT REFERENCES users(id),\n  created_at  INTEGER NOT NULL,\n  updated_at  INTEGER NOT NULL,\n  archived_at INTEGER\n)",
      "CREATE INDEX IF NOT EXISTS idx_dashboards_project ON dashboards(project_id)",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboards_share_token\n  ON dashboards(share_token) WHERE share_token IS NOT NULL",
      "CREATE TABLE IF NOT EXISTS automations (\n  id              TEXT PRIMARY KEY,\n  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  name            TEXT NOT NULL,\n  description     TEXT,\n  enabled         INTEGER NOT NULL DEFAULT 1,                  \n  trigger_type    TEXT NOT NULL CHECK (trigger_type IN\n                    ('variable','scene','schedule','sunset_sunrise','event')),\n  trigger_config  TEXT NOT NULL,                               \n  actions         TEXT NOT NULL,                               \n  created_by      TEXT REFERENCES users(id),\n  created_at      INTEGER NOT NULL,\n  updated_at      INTEGER NOT NULL,\n  last_run_at     INTEGER,\n  last_run_status TEXT CHECK (last_run_status IN ('ok','error','skipped')),\n  last_error      TEXT\n)",
      "CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id)",
      "CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled) WHERE enabled = 1",
      "CREATE TABLE IF NOT EXISTS integrations (\n  id          TEXT PRIMARY KEY,\n  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  name        TEXT NOT NULL,\n  kind        TEXT NOT NULL CHECK (kind IN\n                ('webhook','code_block','slack','email','mqtt','http_service')),\n  config      TEXT NOT NULL,                                   \n  enabled     INTEGER NOT NULL DEFAULT 1,\n  created_by  TEXT REFERENCES users(id),\n  created_at  INTEGER NOT NULL,\n  updated_at  INTEGER NOT NULL,\n  archived_at INTEGER,\n  last_run_at     INTEGER,                                     \n  last_run_status TEXT CHECK (last_run_status IN ('ok','error','skipped')),\n  last_error      TEXT\n)",
      "CREATE INDEX IF NOT EXISTS idx_integrations_project ON integrations(project_id)",
      "CREATE TABLE IF NOT EXISTS audit_log (\n  id          INTEGER PRIMARY KEY AUTOINCREMENT,\n  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,\n  user_id     TEXT REFERENCES users(id)   ON DELETE SET NULL,\n  action      TEXT NOT NULL,                                   \n  target_type TEXT,\n  target_id   TEXT,\n  metadata    TEXT,                                            \n  created_at  INTEGER NOT NULL\n)",
      "CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_audit_log_target  ON audit_log(target_type, target_id)",
      "CREATE TABLE IF NOT EXISTS deployment_settings (\n  key        TEXT PRIMARY KEY,\n  value      TEXT NOT NULL,\n  updated_at INTEGER NOT NULL\n)"
    ]
  }
];
