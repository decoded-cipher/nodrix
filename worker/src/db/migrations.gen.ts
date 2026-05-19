// AUTO-GENERATED at build time by scripts/gen-migrations.ts.
// Source: worker/src/db/migrations/*.sql. Do not edit by hand.

export type Migration = { name: string; statements: string[] };

export const MIGRATIONS: Migration[] = [
  {
    "name": "0001_init",
    "statements": [
      "CREATE TABLE IF NOT EXISTS users (\n  id         TEXT PRIMARY KEY,\n  email      TEXT NOT NULL UNIQUE,\n  role       TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),\n  created_at INTEGER NOT NULL\n)",
      "CREATE TABLE IF NOT EXISTS projects (\n  id         TEXT PRIMARY KEY,\n  name       TEXT NOT NULL,\n  created_at INTEGER NOT NULL\n)",
      "CREATE TABLE IF NOT EXISTS project_members (\n  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  role       TEXT NOT NULL CHECK (role IN ('owner','admin','viewer')),\n  PRIMARY KEY (user_id, project_id)\n)",
      "CREATE TABLE IF NOT EXISTS devices (\n  id         TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  name       TEXT NOT NULL,\n  created_at INTEGER NOT NULL,\n  last_seen  INTEGER\n)",
      "CREATE INDEX IF NOT EXISTS idx_devices_project ON devices(project_id)",
      "CREATE TABLE IF NOT EXISTS device_tokens (\n  id         TEXT PRIMARY KEY,\n  device_id  TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,\n  hash       TEXT NOT NULL UNIQUE,\n  created_at INTEGER NOT NULL,\n  revoked_at INTEGER\n)",
      "CREATE INDEX IF NOT EXISTS idx_device_tokens_device ON device_tokens(device_id)",
      "CREATE TABLE IF NOT EXISTS user_tokens (\n  id           TEXT PRIMARY KEY,\n  project_id   TEXT REFERENCES projects(id) ON DELETE CASCADE,\n  scope        TEXT NOT NULL CHECK (scope IN ('read','admin')),\n  hash         TEXT NOT NULL UNIQUE,\n  created_by   TEXT NOT NULL REFERENCES users(id),\n  created_at   INTEGER NOT NULL,\n  last_used_at INTEGER,\n  revoked_at   INTEGER\n)",
      "CREATE INDEX IF NOT EXISTS idx_user_tokens_project ON user_tokens(project_id)",
      "CREATE TABLE IF NOT EXISTS dashboards (\n  id         TEXT PRIMARY KEY,\n  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  name       TEXT NOT NULL,\n  layout     TEXT NOT NULL,\n  created_at INTEGER NOT NULL,\n  updated_at INTEGER NOT NULL\n)",
      "CREATE INDEX IF NOT EXISTS idx_dashboards_project ON dashboards(project_id)"
    ]
  },
  {
    "name": "0002_schema_v2",
    "statements": [
      "ALTER TABLE users ADD COLUMN display_name  TEXT",
      "ALTER TABLE users ADD COLUMN avatar_url    TEXT",
      "ALTER TABLE users ADD COLUMN last_login_at INTEGER",
      "ALTER TABLE users ADD COLUMN updated_at    INTEGER NOT NULL DEFAULT 0",
      "UPDATE users SET updated_at = created_at WHERE updated_at = 0",
      "ALTER TABLE projects ADD COLUMN description TEXT",
      "ALTER TABLE projects ADD COLUMN icon        TEXT",
      "ALTER TABLE projects ADD COLUMN color       TEXT",
      "ALTER TABLE projects ADD COLUMN created_by  TEXT REFERENCES users(id)",
      "ALTER TABLE projects ADD COLUMN updated_at  INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE projects ADD COLUMN archived_at INTEGER",
      "UPDATE projects SET updated_at = created_at WHERE updated_at = 0",
      "UPDATE projects\n   SET created_by = (\n     SELECT user_id FROM project_members\n      WHERE project_id = projects.id AND role = 'owner'\n      LIMIT 1\n   )\n WHERE created_by IS NULL",
      "ALTER TABLE project_members ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE project_members ADD COLUMN added_by TEXT REFERENCES users(id)",
      "UPDATE project_members\n   SET added_at = (SELECT created_at FROM projects WHERE id = project_id)\n WHERE added_at = 0",
      "ALTER TABLE devices ADD COLUMN description TEXT",
      "ALTER TABLE devices ADD COLUMN created_by  TEXT REFERENCES users(id)",
      "ALTER TABLE devices ADD COLUMN updated_at  INTEGER NOT NULL DEFAULT 0",
      "ALTER TABLE devices ADD COLUMN archived_at INTEGER",
      "UPDATE devices SET updated_at = created_at WHERE updated_at = 0",
      "ALTER TABLE device_tokens ADD COLUMN name         TEXT",
      "ALTER TABLE device_tokens ADD COLUMN last_used_at INTEGER",
      "ALTER TABLE device_tokens ADD COLUMN created_by   TEXT REFERENCES users(id)",
      "ALTER TABLE user_tokens ADD COLUMN name       TEXT",
      "ALTER TABLE user_tokens ADD COLUMN expires_at INTEGER",
      "ALTER TABLE dashboards ADD COLUMN description TEXT",
      "ALTER TABLE dashboards ADD COLUMN created_by  TEXT REFERENCES users(id)",
      "ALTER TABLE dashboards ADD COLUMN visibility  TEXT NOT NULL DEFAULT 'private'\n  CHECK (visibility IN ('private','public'))",
      "ALTER TABLE dashboards ADD COLUMN share_token TEXT",
      "ALTER TABLE dashboards ADD COLUMN archived_at INTEGER",
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboards_share_token\n  ON dashboards(share_token) WHERE share_token IS NOT NULL",
      "CREATE TABLE IF NOT EXISTS automations (\n  id              TEXT PRIMARY KEY,\n  project_id      TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  name            TEXT NOT NULL,\n  description     TEXT,\n  enabled         INTEGER NOT NULL DEFAULT 1,\n  trigger_type    TEXT NOT NULL CHECK (trigger_type IN\n                    ('schedule','device_state','sunset_sunrise','event','scene')),\n  trigger_config  TEXT NOT NULL,\n  actions         TEXT NOT NULL,\n  created_by      TEXT REFERENCES users(id),\n  created_at      INTEGER NOT NULL,\n  updated_at      INTEGER NOT NULL,\n  last_run_at     INTEGER,\n  last_run_status TEXT CHECK (last_run_status IN ('ok','error','skipped')),\n  last_error      TEXT\n)",
      "CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id)",
      "CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled) WHERE enabled = 1",
      "CREATE TABLE IF NOT EXISTS integrations (\n  id          TEXT PRIMARY KEY,\n  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,\n  name        TEXT NOT NULL,\n  kind        TEXT NOT NULL CHECK (kind IN\n                ('webhook','code_block','slack','email','mqtt','http_service')),\n  config      TEXT NOT NULL,\n  enabled     INTEGER NOT NULL DEFAULT 1,\n  created_by  TEXT REFERENCES users(id),\n  created_at  INTEGER NOT NULL,\n  updated_at  INTEGER NOT NULL,\n  archived_at INTEGER\n)",
      "CREATE INDEX IF NOT EXISTS idx_integrations_project ON integrations(project_id)",
      "CREATE TABLE IF NOT EXISTS audit_log (\n  id          INTEGER PRIMARY KEY AUTOINCREMENT,\n  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,\n  user_id     TEXT REFERENCES users(id)   ON DELETE SET NULL,\n  action      TEXT NOT NULL,\n  target_type TEXT,\n  target_id   TEXT,\n  metadata    TEXT,\n  created_at  INTEGER NOT NULL\n)",
      "CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id, created_at DESC)",
      "CREATE INDEX IF NOT EXISTS idx_audit_log_target  ON audit_log(target_type, target_id)"
    ]
  },
  {
    "name": "0003_user_names",
    "statements": [
      "ALTER TABLE users ADD COLUMN first_name TEXT",
      "ALTER TABLE users ADD COLUMN last_name  TEXT",
      "UPDATE users\n   SET first_name = CASE\n         WHEN instr(display_name, ' ') > 0\n         THEN substr(display_name, 1, instr(display_name, ' ') - 1)\n         ELSE display_name\n       END,\n       last_name = CASE\n         WHEN instr(display_name, ' ') > 0\n         THEN trim(substr(display_name, instr(display_name, ' ') + 1))\n         ELSE NULL\n       END\n WHERE display_name IS NOT NULL AND length(trim(display_name)) > 0",
      "ALTER TABLE users DROP COLUMN display_name",
      "ALTER TABLE users DROP COLUMN avatar_url"
    ]
  },
  {
    "name": "0004_auth",
    "statements": [
      "DELETE FROM audit_log",
      "DELETE FROM user_tokens",
      "DELETE FROM device_tokens",
      "DELETE FROM dashboards",
      "DELETE FROM automations",
      "DELETE FROM integrations",
      "DELETE FROM devices",
      "DELETE FROM project_members",
      "DELETE FROM projects",
      "DELETE FROM users",
      "ALTER TABLE users ADD COLUMN name           TEXT",
      "ALTER TABLE users ADD COLUMN image          TEXT",
      "ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0",
      "CREATE TABLE IF NOT EXISTS accounts (\n  id                       TEXT PRIMARY KEY,\n  account_id               TEXT NOT NULL,\n  provider_id              TEXT NOT NULL,\n  user_id                  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  access_token             TEXT,\n  refresh_token            TEXT,\n  id_token                 TEXT,\n  access_token_expires_at  INTEGER,\n  refresh_token_expires_at INTEGER,\n  scope                    TEXT,\n  password                 TEXT,\n  created_at               INTEGER NOT NULL,\n  updated_at               INTEGER NOT NULL\n)",
      "CREATE INDEX IF NOT EXISTS idx_accounts_user     ON accounts(user_id)",
      "CREATE INDEX IF NOT EXISTS idx_accounts_provider ON accounts(provider_id, account_id)",
      "CREATE TABLE IF NOT EXISTS sessions (\n  id          TEXT PRIMARY KEY,\n  token       TEXT NOT NULL UNIQUE,\n  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,\n  expires_at  INTEGER NOT NULL,\n  ip_address  TEXT,\n  user_agent  TEXT,\n  created_at  INTEGER NOT NULL,\n  updated_at  INTEGER NOT NULL\n)",
      "CREATE INDEX IF NOT EXISTS idx_sessions_user  ON sessions(user_id)",
      "CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)",
      "CREATE TABLE IF NOT EXISTS verifications (\n  id          TEXT PRIMARY KEY,\n  identifier  TEXT NOT NULL,\n  value       TEXT NOT NULL,\n  expires_at  INTEGER NOT NULL,\n  created_at  INTEGER NOT NULL,\n  updated_at  INTEGER NOT NULL\n)",
      "CREATE INDEX IF NOT EXISTS idx_verifications_identifier ON verifications(identifier)",
      "CREATE TABLE IF NOT EXISTS auth_providers (\n  kind          TEXT PRIMARY KEY CHECK (kind IN ('google','github')),\n  client_id     TEXT NOT NULL,\n  client_secret TEXT NOT NULL,\n  enabled       INTEGER NOT NULL DEFAULT 1,\n  created_at    INTEGER NOT NULL,\n  updated_at    INTEGER NOT NULL\n)"
    ]
  },
  {
    "name": "0005_deployment_settings",
    "statements": [
      "CREATE TABLE IF NOT EXISTS deployment_settings (\n  key        TEXT PRIMARY KEY,\n  value      TEXT NOT NULL,\n  updated_at INTEGER NOT NULL\n)"
    ]
  },
  {
    "name": "0006_drop_update_settings",
    "statements": [
      "DELETE FROM deployment_settings WHERE key IN (\n  'cf.api_token_enc',\n  'cf.account_id',\n  'cf.account_name',\n  'cf.script_name',\n  'cf.last_build_id',\n  'onboarding.dismissed_at'\n)"
    ]
  }
];
