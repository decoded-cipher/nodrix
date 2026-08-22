import type { SchemaStep } from './schema';

export const PROJECT_SCHEMA: SchemaStep[] = [
  (sql) => {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS latest_state (
        variable    TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        received_at INTEGER NOT NULL
      );
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS ring_buffer (
        rowid    INTEGER PRIMARY KEY AUTOINCREMENT,
        ts       INTEGER NOT NULL,
        variable TEXT NOT NULL,
        value    TEXT NOT NULL
      );
    `);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_ring_buffer_ts ON ring_buffer(ts);`);
    // Serves the per-variable series reads (chart snapshots + delta polls); the
    // ts-only index above stays for age-based eviction.
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_ring_buffer_var_ts ON ring_buffer(variable, ts);`);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS pending_control (
        id           TEXT PRIMARY KEY,
        variable     TEXT NOT NULL,
        value        TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        delivered_at INTEGER
      );
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS flush_meta (
        k TEXT PRIMARY KEY,
        v TEXT
      );
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        dashboard_id TEXT PRIMARY KEY
      );
    `);
    sql.exec(`
      CREATE TABLE IF NOT EXISTS auto_cache (
        k TEXT PRIMARY KEY,
        v TEXT
      );
    `);
  },
  // '' is the default device. NULL can't serve: SQLite treats NULLs as distinct
  // in a unique key, so the upsert would duplicate on every write.
  (sql) => {
    sql.exec(`
      CREATE TABLE latest_state_new (
        device_id   TEXT NOT NULL DEFAULT '',
        variable    TEXT NOT NULL,
        value       TEXT NOT NULL,
        received_at INTEGER NOT NULL,
        PRIMARY KEY (device_id, variable)
      );
    `);
    sql.exec(`
      INSERT INTO latest_state_new (device_id, variable, value, received_at)
      SELECT '', variable, value, received_at FROM latest_state;
    `);
    sql.exec(`DROP TABLE latest_state;`);
    sql.exec(`ALTER TABLE latest_state_new RENAME TO latest_state;`);

    sql.exec(`ALTER TABLE ring_buffer ADD COLUMN device_id TEXT NOT NULL DEFAULT '';`);
    sql.exec(`DROP INDEX IF EXISTS idx_ring_buffer_var_ts;`);
    sql.exec(`CREATE INDEX IF NOT EXISTS idx_ring_buffer_dev_var_ts ON ring_buffer(device_id, variable, ts);`);

    // NULL device still broadcasts.
    sql.exec(`ALTER TABLE pending_control ADD COLUMN device_id TEXT;`);
  },
  (sql) => {
    sql.exec(`
      CREATE TABLE IF NOT EXISTS ota_quota (
        device_id TEXT NOT NULL,
        window    INTEGER NOT NULL,
        count     INTEGER NOT NULL,
        PRIMARY KEY (device_id, window)
      );
    `);
  },
];
