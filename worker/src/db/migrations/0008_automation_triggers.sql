-- v8: realign automation triggers to the Project + Variables model.
--
-- The Device concept was removed in 0007 (Project + Variables pivot), so the
-- old `device_state` trigger is stale. It's replaced by a `variable` trigger
-- that fires on the state/value of a project variable (evaluated on telemetry
-- ingest). The other four trigger types are unchanged.
--
-- SQLite can't ALTER a CHECK constraint in place, so the table is recreated.
-- nodrix is pre-alpha (no migration paths between commits) — this is a clean
-- break that wipes existing automations, the same pattern 0004_auth.sql uses.

DROP TABLE IF EXISTS automations;

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
