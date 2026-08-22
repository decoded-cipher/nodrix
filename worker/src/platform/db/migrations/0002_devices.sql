-- Devices. Rows appear the first time a board is seen; there is no enrolment.
CREATE TABLE IF NOT EXISTS devices (
  id               TEXT PRIMARY KEY,
  project_id       TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  device_key       TEXT,
  chip             TEXT,
  firmware_version TEXT,
  is_default       INTEGER NOT NULL DEFAULT 0,
  first_seen       INTEGER,
  last_seen        INTEGER,
  created_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_devices_project ON devices(project_id);

-- What the board calls itself, kept apart from the id so renaming is free and a
-- MAC never leaks into anything a user reads. NULL on the default device.
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_key
  ON devices(project_id, device_key) WHERE device_key IS NOT NULL;

-- Exactly one default per project, enforced rather than assumed.
CREATE UNIQUE INDEX IF NOT EXISTS idx_devices_default
  ON devices(project_id) WHERE is_default = 1;

-- Every project gets a default device. Telemetry that names no device lands
-- here, so a plain curl with only a token keeps working.
INSERT INTO devices (id, project_id, name, is_default, created_at)
SELECT 'dev_' || substr(p.id, 5), p.id, 'Default', 1, p.created_at
FROM projects p
WHERE NOT EXISTS (SELECT 1 FROM devices d WHERE d.project_id = p.id AND d.is_default = 1);

-- project_variables gains device_id. Rebuilt rather than altered: the column is
-- NOT NULL with a foreign key, and the unique key it belongs to changes shape.
CREATE TABLE project_variables_new (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  device_id   TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  unit        TEXT,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL,
  last_seen   INTEGER
);

INSERT INTO project_variables_new (id, project_id, device_id, key, unit, created_at, updated_at, last_seen)
SELECT v.id, v.project_id, d.id, v.key, v.unit, v.created_at, v.updated_at, v.last_seen
FROM project_variables v
JOIN devices d ON d.project_id = v.project_id AND d.is_default = 1;

DROP TABLE project_variables;
ALTER TABLE project_variables_new RENAME TO project_variables;

CREATE UNIQUE INDEX idx_project_variables_key
  ON project_variables(project_id, device_id, key);

-- Firmware uploaded to this instance. The image itself lives in R2; this is the
-- metadata the dashboard and the update check read.
CREATE TABLE IF NOT EXISTS firmware (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version     TEXT NOT NULL,
  target      TEXT,
  size        INTEGER NOT NULL,
  sha256      TEXT NOT NULL,
  r2_key      TEXT NOT NULL,
  notes       TEXT,
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_firmware_project ON firmware(project_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_firmware_version ON firmware(project_id, version);

-- Desired state. A device compares its own version against this and pulls when
-- they differ; nothing pushes an image at a device.
ALTER TABLE devices ADD COLUMN desired_firmware_id TEXT REFERENCES firmware(id) ON DELETE SET NULL;
ALTER TABLE devices ADD COLUMN ota_status TEXT;
ALTER TABLE devices ADD COLUMN ota_updated_at INTEGER;
