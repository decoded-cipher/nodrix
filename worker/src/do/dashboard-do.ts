import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import type { DeviceDO } from './device-do';
import { validateLayout, devicesAndMetricsFromLayout, type Layout } from '../lib/layout';
import { newId } from '../lib/ids';

// Dashboard Durable Object. One per dashboard id (ctx.id.name === dashboard_id).
//
// MUST use WebSocket Hibernation (state.acceptWebSocket) — see plan §6.2 +
// invariant #3. Without it, idle background tabs pin the DO in memory and
// cost goes through the roof.
//
// Plan §6/§10:
//   - On first socket: load dashboard layout from D1, subscribe to each
//     Device DO referenced by the layout.
//   - On notify from a Device DO: broadcast to every live socket.
//   - On last socket close: unsubscribe from every Device DO.

type Snapshot = {
  type: 'snapshot';
  dashboard: string;
  layout: Layout;
  devices: Record<
    string,
    {
      state: Record<string, { value: unknown; received_at: number }>;
      series: Array<{ ts: number; metric: string; value: unknown }>;
    }
  >;
};

type UpdateMsg = {
  type: 'update';
  device: string;
  metric: string;
  value: unknown;
  ts: number;
};

type AckMsg = { type: 'ack'; req: string; ok: boolean; reason?: string };

type ClientMsg =
  | { type: 'command'; req?: string; device: string; name: string; value?: unknown };

export class DashboardDO extends DurableObject<Env> {
  private sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.initSchema();
  }

  // ---- HTTP entry: WS upgrade ------------------------------------------------

  override async fetch(request: Request): Promise<Response> {
    const upgrade = request.headers.get('upgrade');
    if (upgrade !== 'websocket') {
      return new Response('expected websocket', { status: 400 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    // Hibernation: this is the line that makes idle tabs cheap.
    this.ctx.acceptWebSocket(server);

    // Bootstrap (load layout, subscribe, send snapshot) runs in parallel with
    // the handshake completing. Any send is queued until the client is ready.
    this.ctx.waitUntil(this.bootstrapConnection(server));

    return new Response(null, { status: 101, webSocket: client });
  }

  // ---- RPC: destroy ----------------------------------------------------------

  // Called by the admin DELETE handlers. Tells subscribed Device DOs to stop
  // pushing, then wipes our own storage. Open WebSockets get dropped on
  // storage.deleteAll() — clients will reconnect and fail with 404.
  async destroy(): Promise<void> {
    await this.unsubscribeAll();
    await this.ctx.storage.deleteAll();
  }

  // ---- RPC from Device DOs --------------------------------------------------

  async notify(device: string, metric: string, value: unknown, ts: number): Promise<void> {
    const msg: UpdateMsg = { type: 'update', device, metric, value, ts };
    const json = JSON.stringify(msg);
    for (const ws of this.ctx.getWebSockets()) {
      try {
        ws.send(json);
      } catch {
        // Dead socket; will be cleaned up on webSocketClose.
      }
    }
  }

  // ---- WebSocket hibernation handlers ---------------------------------------

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return; // ignore binary in v1

    let parsed: ClientMsg;
    try {
      parsed = JSON.parse(message) as ClientMsg;
    } catch {
      return;
    }

    if (parsed.type === 'command') {
      await this.handleCommand(ws, parsed);
    }
  }

  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    // If this was the last socket, unsubscribe from every Device DO so we
    // stop receiving notifications nobody can see.
    if (this.ctx.getWebSockets().length === 0) {
      await this.unsubscribeAll();
    }
  }

  override async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      await this.unsubscribeAll();
    }
  }

  // ---- internals -------------------------------------------------------------

  private dashboardId(): string {
    return this.ctx.id.name ?? this.ctx.id.toString();
  }

  private async bootstrapConnection(ws: WebSocket): Promise<void> {
    const dashId = this.dashboardId();
    const row = await this.env.DB
      .prepare(`SELECT id, project_id, layout FROM dashboards WHERE id = ?`)
      .bind(dashId)
      .first<{ id: string; project_id: string; layout: string }>();

    if (!row) {
      try {
        ws.send(JSON.stringify({ type: 'error', reason: 'dashboard_not_found' }));
        ws.close(1011, 'dashboard_not_found');
      } catch {}
      return;
    }

    let layout: Layout;
    try {
      const parsed = JSON.parse(row.layout) as unknown;
      const v = validateLayout(parsed);
      if (!v.ok) {
        ws.send(JSON.stringify({ type: 'error', reason: 'invalid_layout' }));
        ws.close(1011, 'invalid_layout');
        return;
      }
      layout = v.value;
    } catch {
      ws.send(JSON.stringify({ type: 'error', reason: 'invalid_layout' }));
      ws.close(1011, 'invalid_layout');
      return;
    }

    const subs = devicesAndMetricsFromLayout(layout);
    const deviceIds = [...new Set(subs.map((s) => s.device))];

    // Subscribe each referenced Device DO to us (Phase 10 reads back).
    await Promise.all(
      deviceIds.map((d) => this.subscribe(d).catch(() => undefined))
    );

    // Build snapshot in parallel: each Device DO gives latest state + recent series.
    const snapshot: Snapshot = {
      type: 'snapshot',
      dashboard: dashId,
      layout,
      devices: {},
    };

    const results = await Promise.all(
      deviceIds.map(async (deviceId) => {
        const stub = this.env.DEVICE_DO.get(this.env.DEVICE_DO.idFromName(deviceId)) as unknown as DeviceDO;
        const [latest, series] = await Promise.all([
          stub.getLatestState().catch(() => []),
          stub.getSeries(null, Math.floor(Date.now() / 1000) - 60 * 60).catch(() => []),
        ]);
        return { deviceId, latest, series };
      })
    );

    for (const r of results) {
      const state: Record<string, { value: unknown; received_at: number }> = {};
      for (const row of r.latest) state[row.metric] = { value: row.value, received_at: row.received_at };
      snapshot.devices[r.deviceId] = { state, series: r.series };
    }

    try {
      ws.send(JSON.stringify(snapshot));
    } catch {
      // Client disconnected during bootstrap.
    }
  }

  private async handleCommand(ws: WebSocket, msg: ClientMsg & { type: 'command' }): Promise<void> {
    const reqId = msg.req;
    const ack = (ok: boolean, reason?: string): void => {
      if (!reqId) return;
      try {
        const a: AckMsg = { type: 'ack', req: reqId, ok, ...(reason ? { reason } : {}) };
        ws.send(JSON.stringify(a));
      } catch {}
    };

    const dashId = this.dashboardId();
    const row = await this.env.DB
      .prepare(`SELECT project_id FROM dashboards WHERE id = ?`)
      .bind(dashId)
      .first<{ project_id: string }>();
    if (!row) return ack(false, 'dashboard_not_found');

    // Confirm the device belongs to the dashboard's project.
    const dev = await this.env.DB
      .prepare(`SELECT id FROM devices WHERE id = ? AND project_id = ?`)
      .bind(msg.device, row.project_id)
      .first<{ id: string }>();
    if (!dev) return ack(false, 'device_not_in_project');

    const cmdId = newId('command');
    const stub = this.env.DEVICE_DO.get(this.env.DEVICE_DO.idFromName(msg.device)) as unknown as DeviceDO;
    try {
      await stub.addCommand(cmdId, msg.name, msg.value ?? null);
      ack(true);
    } catch (e) {
      ack(false, 'enqueue_failed');
    }
  }

  private async subscribe(deviceId: string): Promise<void> {
    this.sql.exec(
      `INSERT INTO subscribed_devices (device_id) VALUES (?)
       ON CONFLICT(device_id) DO NOTHING`,
      deviceId
    );
    const stub = this.env.DEVICE_DO.get(this.env.DEVICE_DO.idFromName(deviceId)) as unknown as DeviceDO;
    await stub.subscribeDashboard(this.dashboardId());
  }

  private async unsubscribeAll(): Promise<void> {
    const rows = this.sql
      .exec<{ device_id: string }>(`SELECT device_id FROM subscribed_devices`)
      .toArray();
    await Promise.all(
      rows.map(async (r) => {
        try {
          const stub = this.env.DEVICE_DO.get(this.env.DEVICE_DO.idFromName(r.device_id)) as unknown as DeviceDO;
          await stub.unsubscribeDashboard(this.dashboardId());
        } catch {
          // best-effort
        }
      })
    );
    this.sql.exec(`DELETE FROM subscribed_devices`);
  }

  private initSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS subscribed_devices (
        device_id TEXT PRIMARY KEY
      );
    `);
  }
}
