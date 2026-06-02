import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../../env';
import { newId } from '../lib/ids';
import { dashboardStub } from './stubs';
import { runAutomation } from '../engine/run';
import { matchVariableCondition } from '../engine/triggers';
import { toGraph, triggerNodes } from '../engine/graph';
import type { AutomationContext, AutomationRow, VariableTriggerConfig } from '../engine/types';
import { toCompactSeries, type CompactSeries } from '../lib/series';
import { chunk, MAX_BOUND_PARAMS } from '../lib/sql';

// Project Durable Object (one per project id, SQLite-backed): latest variable
// state, recent ring buffer, pending control writes, and the R2 flush cursor.

const RING_BUFFER_MAX_ROWS = 1000;
const RING_BUFFER_MAX_AGE_SECONDS = 60 * 60; // 1 hour
// Multi-row inserts bind 3 columns/row; this keeps a chunk under MAX_BOUND_PARAMS.
const ROWS_PER_3COL_INSERT = Math.floor(MAX_BOUND_PARAMS / 3);
// Eviction (age + overflow DELETE + COUNT) runs at most this often instead of on
// every ingest — a single cheap last_evict_at lookup gates the actual work.
const EVICT_INTERVAL_SECONDS = 30;
const FLUSH_INTERVAL_MS = 60_000;
const HIGH_WATER_MARK_ROWS = 500;
// Variable-trigger automations are cached in DO SQLite so high-rate telemetry
// doesn't read D1 per point. Refreshed when stale or on invalidateAutomations().
const AUTO_CACHE_TTL_MS = 30_000;

export type IngestPoint = {
  variable: string;
  value: number | string | boolean | null;
};

export type IngestResult = {
  receivedAt: number;
  count: number;
};

export type LatestStateRow = {
  variable: string;
  value: unknown;
  received_at: number;
};

export type SeriesRow = {
  ts: number;
  variable: string;
  value: unknown;
};

export type FlushResult = {
  flushed: number;
  keys: string[];
  newCursor: number;
};

export class ProjectDO extends DurableObject<Env> {
  private sql: SqlStorage;
  private projectId(): string {
    // Stored on first ingest; used as the R2 key prefix.
    const row = this.sql
      .exec<{ v: string }>(`SELECT v FROM flush_meta WHERE k = 'project_id'`)
      .toArray()[0];
    return row?.v ?? this.ctx.id.toString();
  }

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initSchema();
  }

  async ingest(projectId: string, points: IngestPoint[], _deviceTs?: number): Promise<IngestResult> {
    const receivedAt = Math.floor(Date.now() / 1000);

    // Persist project_id once for the R2 key (idFromName doesn't round-trip cheaply).
    this.sql.exec(
      `INSERT INTO flush_meta (k, v) VALUES ('project_id', ?)
       ON CONFLICT(k) DO NOTHING`,
      projectId
    );

    // Snapshot prior values before the upsert so edge-triggered automations see
    // the transition; variables with no prior row map to undefined. Chunk the
    // IN(...) under the 100 bound-param limit, else a full batch 500s.
    const uniqueVars = [...new Set(points.map((p) => p.variable))];
    const prev = new Map<string, unknown>();
    for (const v of uniqueVars) prev.set(v, undefined);
    for (const part of chunk(uniqueVars, MAX_BOUND_PARAMS)) {
      const placeholders = part.map(() => '?').join(',');
      const rows = this.sql
        .exec<{ variable: string; value: string }>(
          `SELECT variable, value FROM latest_state WHERE variable IN (${placeholders})`,
          ...part
        )
        .toArray();
      for (const r of rows) prev.set(r.variable, safeParse(r.value));
    }

    // latest_state: multi-row UPSERT, deduped by variable (a multi-row UPSERT
    // can't have two VALUES rows hit the same conflict target).
    const latestByVar = new Map<string, unknown>();
    for (const p of points) latestByVar.set(p.variable, p.value);
    for (const part of chunk([...latestByVar], ROWS_PER_3COL_INSERT)) {
      const rows = part.map(() => '(?, ?, ?)').join(', ');
      const binds: unknown[] = [];
      for (const [variable, value] of part) {
        binds.push(variable, JSON.stringify(value), receivedAt);
      }
      this.sql.exec(
        `INSERT INTO latest_state (variable, value, received_at)
         VALUES ${rows}
         ON CONFLICT(variable) DO UPDATE SET value = excluded.value, received_at = excluded.received_at`,
        ...binds
      );
    }

    // ring_buffer: append every point.
    for (const part of chunk(points, ROWS_PER_3COL_INSERT)) {
      const rows = part.map(() => '(?, ?, ?)').join(', ');
      const binds: unknown[] = [];
      for (const p of part) {
        binds.push(receivedAt, p.variable, JSON.stringify(p.value));
      }
      this.sql.exec(`INSERT INTO ring_buffer (ts, variable, value) VALUES ${rows}`, ...binds);
    }

    // Eviction is independent of the flush cursor (copy-not-move).
    this.evictRingBuffer(receivedAt);
    await this.ensureAlarmScheduled();

    // Fire-and-forget; failures never block ingest — the device already got its 204.
    this.notifyDashboards(points, receivedAt);
    this.evaluateVariableTriggers(projectId, points, prev, receivedAt);

    return { receivedAt, count: points.length };
  }

  private evaluateVariableTriggers(
    projectId: string,
    points: IngestPoint[],
    prev: Map<string, unknown>,
    ts: number
  ): void {
    this.ctx.waitUntil(
      (async () => {
        try {
          const autos = await this.getVariableAutomations(projectId);
          if (autos.length === 0) return;

          const setVariable = (variable: string, value: unknown): Promise<void> =>
            this.addControl(newId('control'), variable, value);
          // Condition nodes read live values; serve them from this DO's own state.
          const getVariable = async (variable: string): Promise<unknown> =>
            (await this.getLatestState()).find((r) => r.variable === variable)?.value;

          for (const a of autos) {
            for (const node of triggerNodes(toGraph(a))) {
              if (node.kind !== 'variable') continue;
              const cfg = node.config as VariableTriggerConfig;

              const point = points.find((p) => p.variable === cfg.variable);
              if (!point) continue;
              if (!matchVariableCondition(cfg, point.value, prev.get(cfg.variable))) continue;

              const ctx: AutomationContext = {
                source: 'variable',
                projectId,
                ts,
                variable: cfg.variable,
                value: point.value,
                depth: 0,
                entryNodeId: node.id,
              };
              await runAutomation(this.env, a, ctx, { setVariable, getVariable });
            }
          }
        } catch (e) {
          console.error('variable-trigger eval failed', e);
        }
      })()
    );
  }

  // Cached list of enabled variable-trigger automations, refreshed from D1 on a
  // short TTL (or eagerly via invalidateAutomations()).
  private async getVariableAutomations(projectId: string): Promise<AutomationRow[]> {
    const now = Date.now();
    const atRow = this.sql
      .exec<{ v: string }>(`SELECT v FROM auto_cache WHERE k = 'cached_at'`)
      .toArray()[0];
    const cachedAt = atRow ? Number(atRow.v) : 0;

    if (now - cachedAt < AUTO_CACHE_TTL_MS) {
      const row = this.sql
        .exec<{ v: string }>(`SELECT v FROM auto_cache WHERE k = 'automations'`)
        .toArray()[0];
      if (row) {
        try { return JSON.parse(row.v) as AutomationRow[]; } catch { /* refetch below */ }
      }
    }

    const res = await this.env.DB
      .prepare(
        `SELECT id, project_id, name, enabled, trigger_type, trigger_config, actions, graph, last_run_at
           FROM automations
          WHERE project_id = ? AND enabled = 1 AND trigger_kinds LIKE '%,variable,%'`
      )
      .bind(projectId)
      .all<AutomationRow>();
    const list = res.results;

    this.sql.exec(
      `INSERT INTO auto_cache (k, v) VALUES ('automations', ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      JSON.stringify(list)
    );
    this.sql.exec(
      `INSERT INTO auto_cache (k, v) VALUES ('cached_at', ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      String(now)
    );
    return list;
  }

  // Called by the admin automations routes after a create/update/delete so the
  // next ingest refetches instead of waiting out the TTL.
  async invalidateAutomations(): Promise<void> {
    this.sql.exec(`DELETE FROM auto_cache WHERE k = 'cached_at'`);
  }

  private notifyDashboards(points: IngestPoint[], ts: number): void {
    const subs = this.sql
      .exec<{ dashboard_id: string }>(`SELECT dashboard_id FROM subscriptions`)
      .toArray();
    if (subs.length === 0) return;

    // One RPC per subscribed dashboard, carrying the whole point batch — not one
    // per (dashboard × point). The Dashboard DO fans each point out to its sockets.
    const batch = points.map((p) => ({ variable: p.variable, value: p.value }));

    // Don't await: ingest returns to the device immediately.
    this.ctx.waitUntil(
      Promise.all(
        subs.map(async (s) => {
          try {
            await dashboardStub(this.env, s.dashboard_id).notifyBatch(batch, ts);
          } catch {
            // Best-effort. A wedged Dashboard DO must not break telemetry.
          }
        })
      ).then(() => undefined)
    );
  }

  // Combined dashboard read (latest state + chart series) in one DO round trip —
  // the poll endpoint and WS bootstrap both need both.
  async getDashboardSnapshot(
    variables: string[],
    sinceTs: number | null,
    cap?: number
  ): Promise<{ latest: LatestStateRow[]; series: CompactSeries }> {
    const latest = this.getLatestState();
    const series = this.getSeriesForVariables(variables, sinceTs, cap);
    return { latest: await latest, series: await series };
  }

  async getLatestState(): Promise<LatestStateRow[]> {
    const rows = this.sql
      .exec<{ variable: string; value: string; received_at: number }>(
        `SELECT variable, value, received_at FROM latest_state ORDER BY variable ASC`
      )
      .toArray();
    return rows.map((r) => ({
      variable: r.variable,
      value: safeParse(r.value),
      received_at: r.received_at,
    }));
  }

  // Series for a set of variables in the compact columnar shape dashboards
  // consume. `cap` stride-samples dense series (full snapshots); omit for deltas.
  async getSeriesForVariables(
    variables: string[],
    sinceTs: number | null,
    cap?: number
  ): Promise<CompactSeries> {
    if (variables.length === 0) return {};
    const cutoff = sinceTs ?? 0;
    const placeholders = variables.map(() => '?').join(',');
    const rows = this.sql
      .exec<{ ts: number; variable: string; value: string }>(
        `SELECT ts, variable, value FROM ring_buffer
         WHERE variable IN (${placeholders}) AND ts >= ?
         ORDER BY ts ASC`,
        ...variables,
        cutoff
      )
      .toArray();
    return toCompactSeries(
      rows.map((r) => ({ ts: r.ts, variable: r.variable, value: safeParse(r.value) })),
      cap
    );
  }

  async getSeries(variable: string | null, sinceTs: number | null): Promise<SeriesRow[]> {
    const cutoff = sinceTs ?? 0;
    const rows = variable
      ? this.sql
          .exec<{ ts: number; variable: string; value: string }>(
            `SELECT ts, variable, value FROM ring_buffer
             WHERE variable = ? AND ts >= ?
             ORDER BY ts ASC`,
            variable,
            cutoff
          )
          .toArray()
      : this.sql
          .exec<{ ts: number; variable: string; value: string }>(
            `SELECT ts, variable, value FROM ring_buffer
             WHERE ts >= ?
             ORDER BY ts ASC`,
            cutoff
          )
          .toArray();
    return rows.map((r) => ({ ts: r.ts, variable: r.variable, value: safeParse(r.value) }));
  }

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

  async addControl(id: string, variable: string, value: unknown): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    this.sql.exec(
      `INSERT INTO pending_control (id, variable, value, created_at, delivered_at)
       VALUES (?, ?, ?, ?, NULL)`,
      id,
      variable,
      JSON.stringify(value),
      now
    );

    // Push to any connected hardware WS clients. If offline, the write stays in
    // pending_control and is flushed on next connect.
    const payload = JSON.stringify({ type: 'control', id, variable, value });
    for (const ws of this.ctx.getWebSockets()) {
      try { ws.send(payload); } catch { /* dead socket; ignore */ }
    }
  }

  async listPendingControl(): Promise<Array<{ id: string; variable: string; value: unknown }>> {
    const rows = this.sql
      .exec<{ id: string; variable: string; value: string }>(
        `SELECT id, variable, value FROM pending_control
         WHERE delivered_at IS NULL
         ORDER BY created_at ASC`
      )
      .toArray();
    return rows.map((r) => ({ id: r.id, variable: r.variable, value: safeParse(r.value) }));
  }

  async ackControl(ids: string[]): Promise<{ acked: number }> {
    if (ids.length === 0) return { acked: 0 };
    const now = Math.floor(Date.now() / 1000);
    const placeholders = ids.map(() => '?').join(',');
    const cursor = this.sql.exec(
      `UPDATE pending_control SET delivered_at = ?
        WHERE id IN (${placeholders}) AND delivered_at IS NULL`,
      now,
      ...ids
    );
    return { acked: cursor.rowsWritten };
  }

  // Drops hot state for a variable. Cold R2 history (partitioned by project+hour)
  // is left in place — orphaned but harmless.
  async deleteVariable(variable: string): Promise<void> {
    this.sql.exec(`DELETE FROM latest_state WHERE variable = ?`, variable);
    this.sql.exec(`DELETE FROM ring_buffer WHERE variable = ?`, variable);
    this.sql.exec(`DELETE FROM pending_control WHERE variable = ?`, variable);
  }

  async flushNow(): Promise<FlushResult> {
    return this.runFlush();
  }

  // The worker forwards GET /v1/control/ws to us after project-token auth.
  // Accepted as a hibernated WS so an always-connected device costs ~zero
  // compute when idle.
  override async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('upgrade');
    if (upgrade !== 'websocket') {
      return new Response('expected websocket', { status: 426 });
    }
    const pair = new WebSocketPair();
    const client = pair[0] as WebSocket;
    const server = pair[1] as WebSocket;
    this.ctx.acceptWebSocket(server);

    // Flush any pending (undelivered) control writes on connect so a device
    // that missed messages while offline catches up immediately. The device
    // acks them via `{type:'ack', ids:[...]}` once processed.
    const pending = this.sql
      .exec<{ id: string; variable: string; value: string }>(
        `SELECT id, variable, value FROM pending_control
          WHERE delivered_at IS NULL
          ORDER BY created_at ASC`
      )
      .toArray();
    for (const cmd of pending) {
      try {
        server.send(JSON.stringify({
          type: 'control',
          id: cmd.id,
          variable: cmd.variable,
          value: safeParse(cmd.value),
        }));
      } catch { /* ignore */ }
    }

    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(_ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    try {
      const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
      const msg = JSON.parse(raw) as { type?: string; ids?: unknown };
      if (msg.type === 'ack' && Array.isArray(msg.ids)) {
        const ids = msg.ids.filter((x): x is string => typeof x === 'string');
        if (ids.length > 0) await this.ackControl(ids);
      }
    } catch { /* malformed frame — drop */ }
  }

  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // No per-connection state to clean up — control writes stay in
    // pending_control and flush on the next connect.
  }

  override async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // Same as close: nothing to do.
  }

  // Wipes all data owned by this project — DO SQLite + R2 telemetry history.
  async destroy(): Promise<void> {
    const projectId = this.projectId();

    // Delete every R2 object under telemetry/{projectId}/ (paginated).
    let cursor: string | undefined;
    do {
      const list = await this.env.R2.list({
        prefix: `telemetry/${projectId}/`,
        ...(cursor ? { cursor } : {}),
      });
      if (list.objects.length > 0) {
        await this.env.R2.delete(list.objects.map((o) => o.key));
      }
      cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    // Cancel any scheduled flush + wipe SQLite storage entirely.
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }

  override async alarm(): Promise<void> {
    const result = await this.runFlush();
    // Only reschedule if there's still unflushed data — keeps idle projects cold.
    if (result.flushed > 0) {
      await this.ctx.storage.setAlarm(Date.now() + FLUSH_INTERVAL_MS);
    }
  }

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
      .exec<{ rowid: number; ts: number; variable: string; value: string }>(
        `SELECT rowid, ts, variable, value FROM ring_buffer WHERE rowid > ? ORDER BY rowid ASC`,
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

    const projectId = this.projectId();
    const keys: string[] = [];

    for (const [bucket, bucketRows] of byHour) {
      const lastRowid = bucketRows[bucketRows.length - 1]!.rowid;
      const key = `telemetry/${projectId}/${bucket}/r-${lastRowid.toString().padStart(12, '0')}.ndjson`;
      const body = bucketRows
        .map((r) =>
          JSON.stringify({ ts: r.ts, variable: r.variable, value: safeParse(r.value) })
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

    // Flush NEVER deletes ring_buffer rows. Eviction owns that.
    return { flushed: rows.length, keys, newCursor };
  }

  private initSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS latest_state (
        variable    TEXT PRIMARY KEY,
        value       TEXT NOT NULL,
        received_at INTEGER NOT NULL
      );
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS ring_buffer (
        rowid    INTEGER PRIMARY KEY AUTOINCREMENT,
        ts       INTEGER NOT NULL,
        variable TEXT NOT NULL,
        value    TEXT NOT NULL
      );
    `);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_ring_buffer_ts ON ring_buffer(ts);`);
    // Serves the per-variable series reads (chart snapshots + delta polls); the
    // ts-only index above stays for age-based eviction.
    this.sql.exec(
      `CREATE INDEX IF NOT EXISTS idx_ring_buffer_var_ts ON ring_buffer(variable, ts);`
    );
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS pending_control (
        id           TEXT PRIMARY KEY,
        variable     TEXT NOT NULL,
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
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS auto_cache (
        k TEXT PRIMARY KEY,
        v TEXT
      );
    `);
  }

  private evictRingBuffer(now: number): void {
    // Gate the actual eviction on a cheap last_evict_at lookup so the age DELETE,
    // COUNT, and overflow DELETE don't run on every single ingest.
    const lastRow = this.sql
      .exec<{ v: string }>(`SELECT v FROM flush_meta WHERE k = 'last_evict_at'`)
      .toArray()[0];
    const lastEvict = lastRow ? Number(lastRow.v) : 0;
    if (now - lastEvict < EVICT_INTERVAL_SECONDS) return;

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

    this.sql.exec(
      `INSERT INTO flush_meta (k, v) VALUES ('last_evict_at', ?)
       ON CONFLICT(k) DO UPDATE SET v = excluded.v`,
      String(now)
    );
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
