import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import type { DashboardDO } from './dashboard-do';

// Device Durable Object. One per device id. SQLite-backed.
// See plan §5: latest state + recent ring buffer + pending commands + flush cursor.

const RING_BUFFER_MAX_ROWS = 1000;
const RING_BUFFER_MAX_AGE_SECONDS = 60 * 60; // 1 hour
const FLUSH_INTERVAL_MS = 60_000;
const HIGH_WATER_MARK_ROWS = 500;

export type IngestPoint = {
  metric: string;
  value: number | string | boolean | null;
};

export type IngestResult = {
  receivedAt: number;
  count: number;
};

export type LatestStateRow = {
  metric: string;
  value: unknown;
  received_at: number;
};

export type SeriesRow = {
  ts: number;
  metric: string;
  value: unknown;
};

export type FlushResult = {
  flushed: number;
  keys: string[];
  newCursor: number;
};

export class DeviceDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private deviceId(): string {
    // Stored on first ingest; used as the R2 key prefix.
    const row = this.sql
      .exec<{ v: string }>(`SELECT v FROM flush_meta WHERE k = 'device_id'`)
      .toArray()[0];
    return row?.v ?? this.ctx.id.toString();
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initSchema();
  }

  // ---- RPC: telemetry ingest -------------------------------------------------

  async ingest(deviceId: string, points: IngestPoint[], _deviceTs?: number): Promise<IngestResult> {
    const receivedAt = Math.floor(Date.now() / 1000);

    // Persist device_id once for the R2 key (idFromName doesn't round-trip cheaply).
    this.sql.exec(
      `INSERT INTO flush_meta (k, v) VALUES ('device_id', ?)
       ON CONFLICT(k) DO NOTHING`,
      deviceId
    );

    for (const p of points) {
      this.sql.exec(
        `INSERT INTO latest_state (metric, value, received_at)
         VALUES (?, ?, ?)
         ON CONFLICT(metric) DO UPDATE SET value = excluded.value, received_at = excluded.received_at`,
        p.metric,
        JSON.stringify(p.value),
        receivedAt
      );
    }

    for (const p of points) {
      this.sql.exec(
        `INSERT INTO ring_buffer (ts, metric, value) VALUES (?, ?, ?)`,
        receivedAt,
        p.metric,
        JSON.stringify(p.value)
      );
    }

    // Eviction is independent of the flush cursor (§5.1 copy-not-move).
    this.evictRingBuffer(receivedAt);

    // Ensure a flush is scheduled.
    await this.ensureAlarmScheduled();

    // Fire-and-forget notify to each subscribed Dashboard DO. Failures here
    // never block ingest — the device already got its 204 (plan §6.1).
    this.notifyDashboards(deviceId, points, receivedAt);

    return { receivedAt, count: points.length };
  }

  private notifyDashboards(deviceId: string, points: IngestPoint[], ts: number): void {
    const subs = this.sql
      .exec<{ dashboard_id: string }>(`SELECT dashboard_id FROM subscriptions`)
      .toArray();
    if (subs.length === 0) return;

    // Don't await: ingest returns to the device immediately.
    this.ctx.waitUntil(
      Promise.all(
        subs.flatMap((s) =>
          points.map(async (p) => {
            try {
              const stub = this.env.DASHBOARD_DO.get(
                this.env.DASHBOARD_DO.idFromName(s.dashboard_id)
              ) as unknown as DashboardDO;
              await stub.notify(deviceId, p.metric, p.value, ts);
            } catch {
              // Best-effort. A wedged Dashboard DO must not break telemetry.
            }
          })
        )
      ).then(() => undefined)
    );
  }

  // ---- RPC: read paths -------------------------------------------------------

  async getLatestState(): Promise<LatestStateRow[]> {
    const rows = this.sql
      .exec<{ metric: string; value: string; received_at: number }>(
        `SELECT metric, value, received_at FROM latest_state ORDER BY metric ASC`
      )
      .toArray();
    return rows.map((r) => ({
      metric: r.metric,
      value: safeParse(r.value),
      received_at: r.received_at,
    }));
  }

  async getSeries(metric: string | null, sinceTs: number | null): Promise<SeriesRow[]> {
    const cutoff = sinceTs ?? 0;
    const rows = metric
      ? this.sql
          .exec<{ ts: number; metric: string; value: string }>(
            `SELECT ts, metric, value FROM ring_buffer
             WHERE metric = ? AND ts >= ?
             ORDER BY ts ASC`,
            metric,
            cutoff
          )
          .toArray()
      : this.sql
          .exec<{ ts: number; metric: string; value: string }>(
            `SELECT ts, metric, value FROM ring_buffer
             WHERE ts >= ?
             ORDER BY ts ASC`,
            cutoff
          )
          .toArray();
    return rows.map((r) => ({ ts: r.ts, metric: r.metric, value: safeParse(r.value) }));
  }

  // ---- RPC: subscriptions (Dashboard DO fan-in) -----------------------------

  async subscribeDashboard(dashboardId: string): Promise<void> {
    this.sql.exec(
      `INSERT INTO subscriptions (dashboard_id) VALUES (?)
       ON CONFLICT(dashboard_id) DO NOTHING`,
      dashboardId
    );
  }

  async unsubscribeDashboard(dashboardId: string): Promise<void> {
    this.sql.exec(`DELETE FROM subscriptions WHERE dashboard_id = ?`, dashboardId);
  }

  // ---- RPC: commands ---------------------------------------------------------

  async addCommand(id: string, name: string, value: unknown): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    this.sql.exec(
      `INSERT INTO pending_commands (id, name, value, created_at, delivered_at)
       VALUES (?, ?, ?, ?, NULL)`,
      id,
      name,
      JSON.stringify(value),
      now
    );

    // Push to any connected device WS clients. If the device is offline the
    // command stays in pending_commands and will be flushed on next connect.
    const payload = JSON.stringify({ type: 'command', id, name, value });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch { /* dead socket; ignore */ }
    }
  }

  async listPendingCommands(): Promise<Array<{ id: string; name: string; value: unknown }>> {
    const rows = this.sql
      .exec<{ id: string; name: string; value: string }>(
        `SELECT id, name, value FROM pending_commands
         WHERE delivered_at IS NULL
         ORDER BY created_at ASC`
      )
      .toArray();
    return rows.map((r) => ({ id: r.id, name: r.name, value: safeParse(r.value) }));
  }

  async ackCommands(ids: string[]): Promise<{ acked: number }> {
    if (ids.length === 0) return { acked: 0 };
    const now = Math.floor(Date.now() / 1000);
    const placeholders = ids.map(() => '?').join(',');
    const cursor = this.sql.exec(
      `UPDATE pending_commands SET delivered_at = ?
        WHERE id IN (${placeholders}) AND delivered_at IS NULL`,
      now,
      ...ids
    );
    return { acked: cursor.rowsWritten };
  }

  // ---- RPC: dev/debug --------------------------------------------------------

  async flushNow(): Promise<FlushResult> {
    return this.runFlush();
  }

  // ---- HTTP entry: device WebSocket upgrade ---------------------------------
  // The worker forwards GET /v1/devices/ws to us after Bearer-token auth.
  // We accept the upgrade as a hibernated WS so an always-connected device
  // costs ~zero compute when idle.
  override async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('upgrade');
    if (upgrade !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0] as WebSocket;
    const server = pair[1] as WebSocket;
    this.ctx.acceptWebSocket(server);

    // Flush any pending (undelivered) commands on connect so a device that
    // missed messages while offline catches up immediately. The device will
    // ack them via `{type:'ack', ids:[...]}` once processed.
    const pending = this.sql
      .exec<{ id: string; name: string; value: string }>(
        `SELECT id, name, value FROM pending_commands
          WHERE delivered_at IS NULL
          ORDER BY created_at ASC`
      )
      .toArray();
    for (const cmd of pending) {
      try {
        server.send(JSON.stringify({
          type: 'command',
          id: cmd.id,
          name: cmd.name,
          value: safeParse(cmd.value),
        }));
      } catch { /* ignore */ }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- WebSocket hibernation handlers ----------------------------------------
  override async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const msg = JSON.parse(raw) as { type?: string; ids?: unknown };
      if (msg.type === 'ack' && Array.isArray(msg.ids)) {
        const ids = msg.ids.filter((x): x is string => typeof x === 'string');
        if (ids.length > 0) await this.ackCommands(ids);
      }
    } catch { /* malformed frame — drop */ }
  }

  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // No per-connection state to clean up — commands stay in pending_commands
    // and flush on the next connect.
  }

  override async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // Same as close: nothing to do.
  }

  // ---- RPC: destroy ----------------------------------------------------------

  // Wipes ALL data owned by this device — DO SQLite + R2 telemetry history.
  // Called by the admin DELETE handlers before the metadata row is removed.
  async destroy(): Promise<void> {
    const deviceId = this.deviceId();

    // Delete every R2 object under telemetry/{deviceId}/. Pagination handles
    // long-lived devices with many hourly partitions.
    let cursor: string | undefined;
    do {
      const list = await this.env.R2.list({
        prefix: `telemetry/${deviceId}/`,
        ...(cursor ? { cursor } : {}),
      });
      if (list.objects.length > 0) {
        await this.env.R2.delete(list.objects.map((o) => o.key));
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    // Cancel any scheduled flush + wipe SQLite + KV storage entirely.
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  // ---- alarm: drive the hot -> cold copy -------------------------------------

  override async alarm(): Promise<void> {
    const result = await this.runFlush();
    // Only reschedule if there's still unflushed data — keeps idle devices cold.
    if (result.flushed > 0) {
      await this.ctx.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
    }
  }

  // ---- internals -------------------------------------------------------------

  private async ensureAlarmScheduled(): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current !== null) return;

    const unflushed = this.unflushedRowCount();
    const delay = unflushed >= HIGH_WATER_MARK_ROWS ? 0 : FLUSH_INTERVAL_MS;
    await this.ctx.storage.setAlarm(Date.now() + delay);
  }

  private unflushedRowCount(): number {
    const cursor = this.getFlushCursor();
    return (
      this.sql
        .exec<{ count: number }>(
          `SELECT COUNT(*) AS count FROM ring_buffer WHERE rowid > ?`,
          cursor
        )
        .one().count
    );
  }

  private getFlushCursor(): number {
    const row = this.sql
      .exec<{ v: string }>(`SELECT v FROM flush_meta WHERE k = 'flush_cursor'`)
      .toArray()[0];
    return row ? Number(row.v) : 0;
  }

  private setFlushCursor(cursor: number): void {
    this.sql.exec(
      `INSERT INTO flush_meta (k, v) VALUES ('flush_cursor', ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      String(cursor)
    );
  }

  private async runFlush(): Promise<FlushResult> {
    const cursor = this.getFlushCursor();
    const rows = this.sql
      .exec<{ rowid: number; ts: number; metric: string; value: string }>(
        `SELECT rowid, ts, metric, value FROM ring_buffer WHERE rowid > ? ORDER BY rowid ASC`,
        cursor
      )
      .toArray();

    if (rows.length === 0) return { flushed: 0, keys: [], newCursor: cursor };

    // Group by UTC hour bucket. Most flushes are single-bucket; cross-hour is rare.
    const byHour = new Map<string, typeof rows>();
    for (const r of rows) {
      const bucket = hourBucket(r.ts);
      const arr = byHour.get(bucket);
      if (arr) arr.push(r);
      else byHour.set(bucket, [r]);
    }

    const deviceId = this.deviceId();
    const keys: string[] = [];

    for (const [bucket, bucketRows] of byHour) {
      const lastRowid = bucketRows[bucketRows.length - 1]!.rowid;
      const key = `telemetry/${deviceId}/${bucket}/r-${lastRowid.toString().padStart(12, '0')}.ndjson`;
      const body = bucketRows
        .map((r) =>
          JSON.stringify({ ts: r.ts, metric: r.metric, value: safeParse(r.value) })
        )
        .join('\n') + '\n';

      // PUT is idempotent for the same key (key derives from lastRowid).
      await this.env.R2.put(key, body, {
        httpMetadata: { contentType: 'application/x-ndjson' },
      });
      keys.push(key);
    }

    const newCursor = rows[rows.length - 1]!.rowid;
    this.setFlushCursor(newCursor);

    // Flush NEVER deletes ring_buffer rows. Eviction owns that (§5.1).
    return { flushed: rows.length, keys, newCursor };
  }

  private initSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS latest_state (
        metric      TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        received_at INTEGER NOT NULL
      );
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ring_buffer (
        rowid  INTEGER PRIMARY KEY AUTOINCREMENT,
        ts     INTEGER NOT NULL,
        metric TEXT NOT NULL,
        value  TEXT NOT NULL
      );
    `);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ring_buffer_ts ON ring_buffer(ts);`);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS pending_commands (
        id           TEXT PRIMARY KEY,
        name         TEXT NOT NULL,
        value        TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        delivered_at INTEGER
      );
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS flush_meta (
        k TEXT PRIMARY KEY,
        v TEXT
      );
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        dashboard_id TEXT PRIMARY KEY
      );
    `);
  }

  private evictRingBuffer(now: number): void {
    const ageCutoff = now - RING_BUFFER_MAX_AGE_SECONDS;
    this.sql.exec(`DELETE FROM ring_buffer WHERE ts < ?`, ageCutoff);

    const row = this.sql
      .exec<{ count: number }>(`SELECT COUNT(*) AS count FROM ring_buffer`)
      .one();
    if (row.count > RING_BUFFER_MAX_ROWS) {
      const overflow = row.count - RING_BUFFER_MAX_ROWS;
      this.sql.exec(
        `DELETE FROM ring_buffer WHERE rowid IN (
           SELECT rowid FROM ring_buffer ORDER BY rowid ASC LIMIT ?
         )`,
        overflow
      );
    }
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

function hourBucket(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const hh = String(d.getUTCHours()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}-${hh}`;
}
