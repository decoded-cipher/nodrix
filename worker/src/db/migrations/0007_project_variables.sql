-- v7: replace the Device concept with Project + Variables.
--
-- nodrix is pre-alpha (no migration paths between commits), so this is a clean
-- break: the devices/device_tokens tables are dropped outright. Hardware now
-- authenticates with a PROJECT-scoped token (project_tokens) and posts telemetry
-- to a project's variables (project_variables) rather than to a device's metrics.
--
-- Variables are minimal by design: a stable `key` (the telemetry JSON field
-- name), an optional display `name`, and an optional `unit`. No type/permission/
-- bounds. Every variable is both readable (telemetry in) and writable (control
-- out). Unknown keys are auto-created on first telemetry write.

DROP TABLE IF EXISTS device_tokens;
DROP TABLE IF EXISTS devices;

CREATE TABLE IF NOT EXISTS project_variables (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,            -- telemetry JSON field name, e.g. 'pm25'
  name        TEXT,                     -- display name (optional)
  unit        TEXT,                     -- optional
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_seen   INTEGER                   -- last telemetry timestamp (unix seconds)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_variables_key
  ON project_variables(project_id, key);

CREATE TABLE IF NOT EXISTS project_tokens (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name         TEXT,
  hash         TEXT NOT NULL UNIQUE,    -- SHA-256(token) hex
  created_by   TEXT REFERENCES users(id),
  created_at   INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_project_tokens_project ON project_tokens(project_id);
