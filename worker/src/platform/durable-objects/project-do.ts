import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../../env';
import { newId } from '../lib/ids';
import { dashboardStub } from './stubs';
import { runAutomation, dispatchEvent } from '../engine/run';
import { matchVariableCondition } from '../engine/triggers';
import { toGraph, triggerNodes } from '../engine/graph';
import type { AutomationContext, AutomationRow, VariableTriggerConfig } from '../engine/types';
import { toCompactSeries, type CompactSeries } from '../lib/series';
import { chunk, MAX_BOUND_PARAMS } from '../lib/sql';
import { parseDeviceMessage } from '../../domains/telemetry/ws-protocol';
import { upsertVariables } from '../../domains/telemetry/variables';
import { defaultDeviceId, normaliseDeviceKey, resolveDevice, recordDeviceSeen, touchDevice } from '../../domains/devices/service';
import { reconcile } from '../../domains/firmware/ota';
import { migrateSchema } from './schema';
import { PROJECT_SCHEMA } from './project-schema';

// Project Durable Object (one per project id, SQLite-backed): latest variable
// state, recent ring buffer, pending control writes, and the R2 flush cursor.

// Shared across devices this would silently thin every chart as hardware is added.
const RING_BUFFER_MAX_ROWS_PER_DEVICE = 1000;
const RING_BUFFER_MAX_AGE_SECONDS = 60 * 60; // 1 hour
// Multi-row inserts bind 4 columns/row; this keeps a chunk under MAX_BOUND_PARAMS.
const ROWS_PER_4COL_INSERT = Math.floor(MAX_BOUND_PARAMS / 4);
// Eviction (age + overflow DELETE + COUNT) runs at most this often instead of on
// every ingest — a single cheap last_evict_at lookup gates the actual work.
const EVICT_INTERVAL_SECONDS = 30;
const FLUSH_INTERVAL_MS = 60_000;
const HIGH_WATER_MARK_ROWS = 500;
// Roughly a megabyte a call, and a boot-looping board would pull it forever.
const OTA_DOWNLOADS_PER_HOUR = 6;
// A cold toolchain install can take minutes; a warm build is seconds.
const BUILD_TIMEOUT_MS = 5 * 60_000;
const MAX_BUILD_LOG_LINES = 500;
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
  device_id: string;
  variable: string;
  value: unknown;
  received_at: number;
};

export type SeriesRow = {
  ts: number;
  variable: string;
  value: unknown;
};

// The artifact goes to R2 on its own route; only its id crosses the DO.
export type BuildOutcome =
  | { ok: true; build: string }
  | { ok: false; error: string; code?: string };

type PendingBuild = { controller: ReadableByteStreamController; lines: number; done: boolean };

export type FlushResult = {
  flushed: number;
  keys: string[];
  newCursor: number;
};


export class ProjectDO extends DurableObject<Env> {
  private sql: SqlStorage;
  // Held only while a browser waits on the response, so hibernation can't strand one.
  private pendingBuilds = new Map<string, PendingBuild>();

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
    migrateSchema(ctx, PROJECT_SCHEMA);
  }

  // WS connect calls this so the DO has its project_id for socket-driven ingest —
  // an all-WS device never POSTs, which is where projectId() otherwise gets set.
  async setProjectId(projectId: string): Promise<void> {
    this.sql.exec(
      `INSERT INTO flush_meta (k, v) VALUES ('project_id', ?) ON CONFLICT(k) DO NOTHING`,
      projectId
    );
  }

  async ingest(projectId: string, points: IngestPoint[], deviceId = ''): Promise<IngestResult> {
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
          `SELECT variable, value FROM latest_state WHERE device_id = ? AND variable IN (${placeholders})`,
          deviceId,
          ...part
        )
        .toArray();
      for (const r of rows) prev.set(r.variable, safeParse(r.value));
    }

    // latest_state: multi-row UPSERT, deduped by variable (a multi-row UPSERT
    // can't have two VALUES rows hit the same conflict target).
    const latestByVar = new Map<string, unknown>();
    for (const p of points) latestByVar.set(p.variable, p.value);
    for (const part of chunk([...latestByVar], ROWS_PER_4COL_INSERT)) {
      const rows = part.map(() => '(?, ?, ?, ?)').join(', ');
      const binds: unknown[] = [];
      for (const [variable, value] of part) {
        binds.push(deviceId, variable, JSON.stringify(value), receivedAt);
      }
      this.sql.exec(
        `INSERT INTO latest_state (device_id, variable, value, received_at)
         VALUES ${rows}
         ON CONFLICT(device_id, variable) DO UPDATE SET value = excluded.value, received_at = excluded.received_at`,
        ...binds
      );
    }

    // ring_buffer: append every point.
    for (const part of chunk(points, ROWS_PER_4COL_INSERT)) {
      const rows = part.map(() => '(?, ?, ?, ?)').join(', ');
      const binds: unknown[] = [];
      for (const p of part) {
        binds.push(receivedAt, deviceId, p.variable, JSON.stringify(p.value));
      }
      this.sql.exec(`INSERT INTO ring_buffer (ts, device_id, variable, value) VALUES ${rows}`, ...binds);
    }

    // Eviction is independent of the flush cursor (copy-not-move).
    this.evictRingBuffer(receivedAt);
    await this.ensureAlarmScheduled();

    // Fire-and-forget; failures never block ingest — the device already got its 204.
    this.notifyDashboards(points, receivedAt);
    this.evaluateVariableTriggers(projectId, points, prev, receivedAt, deviceId);

    return { receivedAt, count: points.length };
  }

  private evaluateVariableTriggers(
    projectId: string,
    points: IngestPoint[],
    prev: Map<string, unknown>,
    ts: number,
    deviceId: string
  ): void {
    this.ctx.waitUntil(
      (async () => {
        try {
          const autos = await this.getVariableAutomations(projectId);
          if (autos.length === 0) return;

          // Triggers name devices by their D1 id; storage calls the default one ''.
          const triggerDevice = deviceId || (await defaultDeviceId(this.env, projectId)) || '';

          // Both stay on the device that triggered: an automation that reacts to one
          // greenhouse shouldn't read or switch another's.
          const setVariable = (variable: string, value: unknown): Promise<void> =>
            this.addControl(newId('control'), variable, value, deviceId);
          const getVariable = async (variable: string): Promise<unknown> =>
            (await this.getLatestState())
              .find((r) => r.device_id === deviceId && r.variable === variable)?.value;

          for (const a of autos) {
            for (const node of triggerNodes(toGraph(a))) {
              if (node.kind !== 'variable') continue;
              const cfg = node.config as VariableTriggerConfig;

              if (cfg.device && cfg.device !== triggerDevice) continue;

              const point = points.find((p) => p.variable === cfg.variable);
              if (!point) continue;
              if (!matchVariableCondition(cfg, point.value, prev.get(cfg.variable))) continue;

              const ctx: AutomationContext = {
                source: 'variable',
                projectId,
                ts,
                variable: cfg.variable,
                value: point.value,
                device: triggerDevice,
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
        `SELECT id, project_id, name, enabled, trigger_type, graph, last_run_at
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
    cap?: number,
    deviceId = ''
  ): Promise<{ latest: LatestStateRow[]; series: CompactSeries; oldestTs: number | null }> {
    const latest = this.getLatestState(deviceId);
    const series = this.getSeriesForVariables(variables, sinceTs, cap, deviceId);
    return { latest: await latest, series: await series, oldestTs: this.ringOldestTs() };
  }

  // Oldest ts in the ring — the eviction frontier the Dashboard DO checks before
  // serving a reconnect cursor as a delta.
  private ringOldestTs(): number | null {
    const rows = this.sql
      .exec<{ m: number | null }>(`SELECT MIN(ts) AS m FROM ring_buffer`)
      .toArray();
    return rows[0]?.m ?? null;
  }

  async getLatestState(deviceId?: string | null): Promise<LatestStateRow[]> {
    const rows = this.sql
      .exec<{ device_id: string; variable: string; value: string; received_at: number }>(
        `SELECT device_id, variable, value, received_at FROM latest_state
         ${deviceId != null ? 'WHERE device_id = ?' : ''}
         ORDER BY device_id ASC, variable ASC`,
        ...(deviceId != null ? [deviceId] : [])
      )
      .toArray();
    return rows.map((r) => ({
      device_id: r.device_id,
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
    cap?: number,
    deviceId?: string | null
  ): Promise<CompactSeries> {
    if (variables.length === 0) return {};
    const cutoff = sinceTs ?? 0;
    const placeholders = variables.map(() => '?').join(',');
    const scoped = deviceId != null;
    const rows = this.sql
      .exec<{ ts: number; variable: string; value: string }>(
        `SELECT ts, variable, value FROM ring_buffer
         WHERE variable IN (${placeholders}) AND ts >= ?${scoped ? ' AND device_id = ?' : ''}
         ORDER BY ts ASC`,
        ...variables,
        cutoff,
        ...(scoped ? [deviceId] : [])
      )
      .toArray();
    return toCompactSeries(
      rows.map((r) => ({ ts: r.ts, variable: r.variable, value: safeParse(r.value) })),
      cap
    );
  }

  async getSeries(
    variable: string | null,
    sinceTs: number | null,
    deviceId?: string | null
  ): Promise<SeriesRow[]> {
    const cutoff = sinceTs ?? 0;
    const where = ['ts >= ?'];
    const binds: unknown[] = [cutoff];
    if (variable) { where.push('variable = ?'); binds.push(variable); }
    if (deviceId != null) { where.push('device_id = ?'); binds.push(deviceId); }
    const rows = this.sql
      .exec<{ ts: number; variable: string; value: string }>(
        `SELECT ts, variable, value FROM ring_buffer
         WHERE ${where.join(' AND ')}
         ORDER BY ts ASC`,
        ...binds
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

  async addControl(id: string, variable: string, value: unknown, deviceId: string | null = null): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    this.sql.exec(
      `INSERT INTO pending_control (id, variable, value, created_at, delivered_at, device_id)
       VALUES (?, ?, ?, ?, NULL, ?)`,
      id,
      variable,
      JSON.stringify(value),
      now,
      deviceId
    );

    // Push to connected hardware. If offline, the write stays in pending_control
    // and is flushed on next connect.
    const payload = JSON.stringify({ type: 'control', id, variable, value });
    for (const ws of this.ctx.getWebSockets()) {
      if (deviceId !== null && this.deviceOf(ws) !== deviceId) continue;
      try { ws.send(payload); } catch { /* dead socket; ignore */ }
    }

    this.notifyDashboards([{ variable, value: value as IngestPoint['value'] }], now);
  }

  // A device sees broadcasts and its own writes, never another device's.
  async listPendingControl(deviceId = ''): Promise<Array<{ id: string; variable: string; value: unknown }>> {
    const rows = this.sql
      .exec<{ id: string; variable: string; value: string }>(
        `SELECT id, variable, value FROM pending_control
         WHERE delivered_at IS NULL AND (device_id IS NULL OR device_id = ?)
         ORDER BY created_at ASC`,
        deviceId
      )
      .toArray();
    return rows.map((r) => ({ id: r.id, variable: r.variable, value: safeParse(r.value) }));
  }

  async ackControl(ids: string[], deviceId = ''): Promise<{ acked: number }> {
    if (ids.length === 0) return { acked: 0 };
    const now = Math.floor(Date.now() / 1000);
    const placeholders = ids.map(() => '?').join(',');
    const cursor = this.sql.exec(
      `UPDATE pending_control SET delivered_at = ?
        WHERE id IN (${placeholders}) AND delivered_at IS NULL
          AND (device_id IS NULL OR device_id = ?)`,
      now,
      ...ids,
      deviceId
    );
    return { acked: cursor.rowsWritten };
  }

  // Drops hot state for a variable. Cold R2 history (partitioned by project+hour)
  // is left in place — orphaned but harmless.
  async deleteVariable(variable: string, deviceId?: string | null): Promise<void> {
    if (deviceId == null) {
      this.sql.exec(`DELETE FROM latest_state WHERE variable = ?`, variable);
      this.sql.exec(`DELETE FROM ring_buffer WHERE variable = ?`, variable);
      this.sql.exec(`DELETE FROM pending_control WHERE variable = ?`, variable);
      return;
    }
    this.sql.exec(`DELETE FROM latest_state WHERE variable = ? AND device_id = ?`, variable, deviceId);
    this.sql.exec(`DELETE FROM ring_buffer WHERE variable = ? AND device_id = ?`, variable, deviceId);
    this.sql.exec(`DELETE FROM pending_control WHERE variable = ? AND device_id IS ?`, variable, deviceId);
  }

  private isAgent(ws: WebSocket): boolean {
    return (ws.deserializeAttachment() as { role?: string } | null)?.role === 'agent';
  }

  // NDJSON as the build happens: a cold toolchain install is minutes long, and a
  // console that prints nothing until the end reads as a hang. RPC carries byte
  // streams only, hence type: 'bytes'.
  requestBuild(fqbn: string, sketch: string): ReadableStream<Uint8Array> {
    const id = newId('build');
    const agent = this.ctx.getWebSockets().find((ws) => this.isAgent(ws));

    return new ReadableStream({
      type: 'bytes',
      start: (controller) => {
        const pending: PendingBuild = { controller, lines: 0, done: false };
        if (!agent) {
          return this.finishBuild(pending, { ok: false, code: 'no_agent', error: 'no agent is connected' });
        }

        this.pendingBuilds.set(id, pending);
        setTimeout(() => {
          if (this.pendingBuilds.delete(id)) this.finishBuild(pending, { ok: false, error: 'timed out' });
        }, BUILD_TIMEOUT_MS);
        try {
          agent.send(JSON.stringify({ type: 'build', id, fqbn, sketch }));
        } catch {
          this.pendingBuilds.delete(id);
          this.finishBuild(pending, { ok: false, error: 'the agent went away' });
        }
      },
    });
  }

  private writeBuildFrame(p: PendingBuild, frame: unknown): void {
    if (p.done) return;
    try {
      p.controller.enqueue(new TextEncoder().encode(`${JSON.stringify(frame)}\n`));
    } catch {
      p.done = true;
    }
  }

  private finishBuild(p: PendingBuild, result: BuildOutcome): void {
    if (p.done) return;
    this.writeBuildFrame(p, { type: 'result', ...result });
    p.done = true;
    try {
      p.controller.close();
    } catch { /* the reader went away */ }
  }

  private handleAgentFrame(raw: string): void {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return;
    }
    const build = typeof msg['build'] === 'string' ? msg['build'] : '';
    const pending = this.pendingBuilds.get(build);
    if (!pending) return;

    if (msg['type'] === 'log' && typeof msg['line'] === 'string') {
      if (pending.lines++ < MAX_BUILD_LOG_LINES) this.writeBuildFrame(pending, { type: 'log', line: msg['line'] });
      return;
    }
    if (msg['type'] !== 'result') return;
    this.pendingBuilds.delete(build);
    // The agent uploads before it reports, so ok means the object is already there.
    this.finishBuild(
      pending,
      msg['ok'] === true ? { ok: true, build } : { ok: false, error: String(msg['error'] ?? 'build failed') }
    );
  }

  // Survives hibernation, unlike anything held in memory.
  private deviceOf(ws: WebSocket): string {
    const att = ws.deserializeAttachment() as { device?: string } | null;
    return typeof att?.device === 'string' ? att.device : '';
  }

  // The attachment holds a storage id; '' has to become a real D1 id.
  private async d1DeviceId(ws: WebSocket, projectId: string): Promise<string | null> {
    return this.deviceOf(ws) || (await defaultDeviceId(this.env, projectId));
  }

  private sendPending(ws: WebSocket, where: string, ...binds: unknown[]): void {
    const rows = this.sql
      .exec<{ id: string; variable: string; value: string }>(
        `SELECT id, variable, value FROM pending_control
          WHERE delivered_at IS NULL AND ${where}
          ORDER BY created_at ASC`,
        ...binds
      )
      .toArray();
    for (const cmd of rows) {
      try {
        ws.send(JSON.stringify({ type: 'control', id: cmd.id, variable: cmd.variable, value: safeParse(cmd.value) }));
      } catch { /* dead socket; ignore */ }
    }
  }

  // In DO SQLite, not KV: an eventually consistent counter can be outrun.
  async consumeOtaQuota(deviceId: string): Promise<boolean> {
    const window = Math.floor(Date.now() / 1000 / 3600);
    this.sql.exec(`DELETE FROM ota_quota WHERE window < ?`, window);
    const row = this.sql
      .exec<{ count: number }>(`SELECT count FROM ota_quota WHERE device_id = ? AND window = ?`, deviceId, window)
      .toArray()[0];
    if ((row?.count ?? 0) >= OTA_DOWNLOADS_PER_HOUR) return false;
    this.sql.exec(
      `INSERT INTO ota_quota (device_id, window, count) VALUES (?, ?, 1)
       ON CONFLICT(device_id, window) DO UPDATE SET count = count + 1`,
      deviceId,
      window
    );
    return true;
  }

  // A nudge, not a push: the device still decides whether to pull.
  async notifyOta(deviceId: string): Promise<void> {
    const payload = JSON.stringify({ type: 'ota' });
    for (const ws of this.ctx.getWebSockets()) {
      if (this.deviceOf(ws) !== deviceId) continue;
      try { ws.send(payload); } catch { /* dead socket; ignore */ }
    }
  }

  async deleteDevice(deviceId: string): Promise<void> {
    this.sql.exec(`DELETE FROM latest_state WHERE device_id = ?`, deviceId);
    this.sql.exec(`DELETE FROM ring_buffer WHERE device_id = ?`, deviceId);
    this.sql.exec(`DELETE FROM pending_control WHERE device_id = ?`, deviceId);
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

    if (request.headers.get('x-nodrix-role') === 'agent') {
      server.serializeAttachment({ role: 'agent' });
      return new Response(null, { status: 101, webSocket: client });
    }

    // Until a hello arrives the socket counts as the default device.
    server.serializeAttachment({ device: '' });
    this.sendPending(server, `(device_id IS NULL OR device_id = '')`);

    return new Response(null, { status: 101, webSocket: client });
  }

  // Device->cloud frames: ack, telemetry, events — same verbs as HTTP via the shared
  // parser. Invalid input → error frame; unknown/garbage → dropped.
  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const raw = typeof message === 'string' ? message : new TextDecoder().decode(message);
    if (this.isAgent(ws)) return this.handleAgentFrame(raw);
    const msg = parseDeviceMessage(raw);
    switch (msg.kind) {
      case 'hello': {
        const pid = this.projectId();
        const key = normaliseDeviceKey(msg.device);
        const device = key ? await resolveDevice(this.env, pid, key, Math.floor(Date.now() / 1000)) : null;
        if (!device || !device.storageId) return;
        ws.serializeAttachment({ device: device.storageId });
        this.ctx.waitUntil(
          recordDeviceSeen(this.env, device.id, msg.chip, msg.firmware)
            .then(() => reconcile(this.env, device.id, msg.firmware ?? null))
        );
        this.sendPending(ws, `device_id = ?`, device.storageId);
        return;
      }
      case 'ack':
        if (msg.ids.length > 0) await this.ackControl(msg.ids, this.deviceOf(ws));
        return;
      case 'telemetry': {
        const pid = this.projectId();
        await this.ingest(pid, msg.points, this.deviceOf(ws));
        const now = Math.floor(Date.now() / 1000);
        this.ctx.waitUntil(
          this.d1DeviceId(ws, pid).then((id) =>
            id
              ? Promise.all([
                  upsertVariables(this.env, pid, id, msg.points.map((p) => p.variable), now),
                  touchDevice(this.env, id),
                ])
              : undefined
          )
        );
        return;
      }
      case 'event':
        this.ctx.waitUntil(dispatchEvent(this.env, this.projectId(), msg.event, msg.payload));
        return;
      case 'error':
        try {
          ws.send(JSON.stringify({ type: 'error', code: msg.code, ...(msg.key ? { key: msg.key } : {}) }));
        } catch { /* dead socket; ignore */ }
        return;
      case 'ignore':
        return;
    }
  }

  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // No per-connection state to clean up — control writes stay in
    // pending_control and flush on the next connect.
  }

  override async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    // Same as close: nothing to do.
  }

  // Wipes all data owned by this project — DO SQLite + everything it owns in R2.
  async destroy(): Promise<void> {
    const projectId = this.projectId();

    // A prefix added elsewhere and not listed here leaks objects nothing reaches.
    for (const prefix of [`telemetry/${projectId}/`, `firmware/${projectId}/`, `builds/${projectId}/`]) {
      let cursor: string | undefined;
      do {
        const list = await this.env.R2.list({ prefix, ...(cursor ? { cursor } : {}) });
        if (list.objects.length > 0) {
          await this.env.R2.delete(list.objects.map((o) => o.key));
        }
        cursor = list.truncated ? list.cursor : undefined;
      } while (cursor);
    }

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
      .exec<{ rowid: number; ts: number; device_id: string; variable: string; value: string }>(
        `SELECT rowid, ts, device_id, variable, value FROM ring_buffer WHERE rowid > ? ORDER BY rowid ASC`,
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
          JSON.stringify({ ts: r.ts, device: r.device_id || null, variable: r.variable, value: safeParse(r.value) })
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

    const over = this.sql
      .exec<{ device_id: string; count: number }>(
        `SELECT device_id, COUNT(*) AS count FROM ring_buffer
          GROUP BY device_id HAVING count > ?`,
        RING_BUFFER_MAX_ROWS_PER_DEVICE
      )
      .toArray();
    for (const d of over) {
      this.sql.exec(
        `DELETE FROM ring_buffer WHERE rowid IN (
           SELECT rowid FROM ring_buffer WHERE device_id = ? ORDER BY rowid ASC LIMIT ?
         )`,
        d.device_id,
        d.count - RING_BUFFER_MAX_ROWS_PER_DEVICE
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
