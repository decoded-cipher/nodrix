-- v2: forward-compat columns on existing tables + new tables (automations,
-- integrations, audit_log) backing the UI stubs introduced for the Automations
-- and Integrations sections.
--
-- Applied via `wrangler d1 migrations apply nodrix` against existing
-- deployments. Fresh deployments get the same end state from src/db/schema.sql
-- (and src/db/migrate.ts STATEMENTS) — keep those in sync with this file.

------------------------------------------------------------------------
-- users
------------------------------------------------------------------------
ALTER TABLE users ADD COLUMN display_name  TEXT;
ALTER TABLE users ADD COLUMN avatar_url    TEXT;
ALTER TABLE users ADD COLUMN last_login_at INTEGER;
ALTER TABLE users ADD COLUMN updated_at    INTEGER NOT NULL DEFAULT 0;
UPDATE users SET updated_at = created_at WHERE updated_at = 0;

------------------------------------------------------------------------
-- projects
------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN description TEXT;
ALTER TABLE projects ADD COLUMN icon        TEXT;
ALTER TABLE projects ADD COLUMN color       TEXT;
ALTER TABLE projects ADD COLUMN created_by  TEXT REFERENCES users(id);
ALTER TABLE projects ADD COLUMN updated_at  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN archived_at INTEGER;
UPDATE projects SET updated_at = created_at WHERE updated_at = 0;
-- Backfill created_by from the project's owner member, if there is one.
UPDATE projects
   SET created_by = (
     SELECT user_id FROM project_members
      WHERE project_id = projects.id AND role = 'owner'
      LIMIT 1
   )
 WHERE created_by IS NULL;

------------------------------------------------------------------------
-- project_members
------------------------------------------------------------------------
ALTER TABLE project_members ADD COLUMN added_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_members ADD COLUMN added_by TEXT REFERENCES users(id);
UPDATE project_members
   SET added_at = (SELECT created_at FROM projects WHERE id = project_id)
 WHERE added_at = 0;

------------------------------------------------------------------------
-- devices
------------------------------------------------------------------------
ALTER TABLE devices ADD COLUMN description TEXT;
ALTER TABLE devices ADD COLUMN created_by  TEXT REFERENCES users(id);
ALTER TABLE devices ADD COLUMN updated_at  INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN archived_at INTEGER;
UPDATE devices SET updated_at = created_at WHERE updated_at = 0;

------------------------------------------------------------------------
-- device_tokens
------------------------------------------------------------------------
ALTER TABLE device_tokens ADD COLUMN name         TEXT;
ALTER TABLE device_tokens ADD COLUMN last_used_at INTEGER;
ALTER TABLE device_tokens ADD COLUMN created_by   TEXT REFERENCES users(id);

------------------------------------------------------------------------
-- user_tokens
------------------------------------------------------------------------
ALTER TABLE user_tokens ADD COLUMN name       TEXT;
ALTER TABLE user_tokens ADD COLUMN expires_at INTEGER;

------------------------------------------------------------------------
-- dashboards
------------------------------------------------------------------------
ALTER TABLE dashboards ADD COLUMN description TEXT;
ALTER TABLE dashboards ADD COLUMN created_by  TEXT REFERENCES users(id);
ALTER TABLE dashboards ADD COLUMN visibility  TEXT NOT NULL DEFAULT 'private'
  CHECK (visibility IN ('private','public'));
ALTER TABLE dashboards ADD COLUMN share_token TEXT;
ALTER TABLE dashboards ADD COLUMN archived_at INTEGER;
CREATE UNIQUE INDEX IF NOT EXISTS idx_dashboards_share_token
  ON dashboards(share_token) WHERE share_token IS NOT NULL;

------------------------------------------------------------------------
-- automations (NEW)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS automations (
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
);
CREATE INDEX IF NOT EXISTS idx_automations_project ON automations(project_id);
CREATE INDEX IF NOT EXISTS idx_automations_enabled ON automations(enabled) WHERE enabled = 1;

------------------------------------------------------------------------
-- integrations (NEW)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS integrations (
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
);
CREATE INDEX IF NOT EXISTS idx_integrations_project ON integrations(project_id);

------------------------------------------------------------------------
-- audit_log (NEW) — append-only
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id  TEXT REFERENCES projects(id) ON DELETE SET NULL,
  user_id     TEXT REFERENCES users(id)   ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT,
  target_id   TEXT,
  metadata    TEXT,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_log_project ON audit_log(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_target  ON audit_log(target_type, target_id);
