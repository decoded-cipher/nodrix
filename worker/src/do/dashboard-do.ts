import { DurableObject } from 'cloudflare:workers';
import type { Env } from '../env';
import type { ProjectDO } from './project-do';
import { validateLayout, type Layout } from '../lib/layout';
import { newId } from '../lib/ids';

// Dashboard Durable Object. One per dashboard id (ctx.id.name === dashboard_id).
//
// MUST use WebSocket Hibernation (state.acceptWebSocket). Without it, idle
// background tabs pin the DO in memory and cost goes through the roof.
//
//   - On first socket: load dashboard layout from D1, subscribe to the one
//     Project DO that owns this dashboard.
//   - On notify from the Project DO: broadcast to every live socket.
//   - On last socket close: unsubscribe from the Project DO.

type Snapshot = {
  type: 'snapshot';
  dashboard: string;
  layout: Layout;
  variables: Record<string, { value: unknown; received_at: number }>;
  series: Array<{ ts: number; variable: string; value: unknown }>;
};

type UpdateMsg = {
  type: 'update';
  variable: string;
  value: unknown;
  ts: number;
};

type AckMsg = { type: 'ack'; req: string; ok: boolean; reason?: string };

type ClientMsg =
  | { type: 'control'; req?: string; variable: string; value?: unknown };

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

  // Called by the admin DELETE handlers. Tells the subscribed Project DO to stop
  // pushing, then wipes our own storage. Open WebSockets get dropped on
  // storage.deleteAll() — clients will reconnect and fail with 404.
  async destroy(): Promise<void> {
    await this.unsubscribe();
    await this.ctx.storage.deleteAll();
  }

  // ---- RPC from the Project DO ----------------------------------------------

  async notify(variable: string, value: unknown, ts: number): Promise<void> {
    const msg: UpdateMsg = { type: 'update', variable, value, ts };
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

    if (parsed.type === 'control') {
      await this.handleControl(ws, parsed);
    }
  }

  override async webSocketClose(_ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      await this.unsubscribe();
    }
  }

  override async webSocketError(_ws: WebSocket, _error: unknown): Promise<void> {
    if (this.ctx.getWebSockets().length === 0) {
      await this.unsubscribe();
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

    // Subscribe the one Project DO that owns this dashboard.
    await this.subscribe(row.project_id).catch(() => undefined);

    const stub = this.env.PROJECT_DO.get(
      this.env.PROJECT_DO.idFromName(row.project_id)
    ) as unknown as ProjectDO;
    const [latest, series] = await Promise.all([
      stub.getLatestState().catch(() => []),
      stub.getSeries(null, Math.floor(Date.now() / 1000) - 60 * 60).catch(() => []),
    ]);

    const variables: Record<string, { value: unknown; received_at: number }> = {};
    for (const r of latest) variables[r.variable] = { value: r.value, received_at: r.received_at };

    const snapshot: Snapshot = {
      type: 'snapshot',
      dashboard: dashId,
      layout,
      variables,
      series,
    };

    try {
      ws.send(JSON.stringify(snapshot));
    } catch {
      // Client disconnected during bootstrap.
    }
  }

  private async handleControl(ws: WebSocket, msg: ClientMsg & { type: 'control' }): Promise<void> {
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

    // Confirm the variable belongs to the dashboard's project.
    const variable = await this.env.DB
      .prepare(`SELECT id FROM project_variables WHERE project_id = ? AND key = ?`)
      .bind(row.project_id, msg.variable)
      .first<{ id: string }>();
    if (!variable) return ack(false, 'variable_not_in_project');

    const cmdId = newId('control');
    const stub = this.env.PROJECT_DO.get(
      this.env.PROJECT_DO.idFromName(row.project_id)
    ) as unknown as ProjectDO;
    try {
      await stub.addControl(cmdId, msg.variable, msg.value ?? null);
      ack(true);
    } catch (e) {
      ack(false, 'enqueue_failed');
    }
  }

  private async subscribe(projectId: string): Promise<void> {
    this.sql.exec(
      `INSERT INTO subscribed_project (project_id) VALUES (?)
       ON CONFLICT(project_id) DO NOTHING`,
      projectId
    );
    const stub = this.env.PROJECT_DO.get(
      this.env.PROJECT_DO.idFromName(projectId)
    ) as unknown as ProjectDO;
    await stub.subscribeDashboard(this.dashboardId());
  }

  private async unsubscribe(): Promise<void> {
    const rows = this.sql
      .exec<{ project_id: string }>(`SELECT project_id FROM subscribed_project`)
      .toArray();
    await Promise.all(
      rows.map(async (r) => {
        try {
          const stub = this.env.PROJECT_DO.get(
            this.env.PROJECT_DO.idFromName(r.project_id)
          ) as unknown as ProjectDO;
          await stub.unsubscribeDashboard(this.dashboardId());
        } catch {
          // best-effort
        }
      })
    );
    this.sql.exec(`DELETE FROM subscribed_project`);
  }

  private initSchema(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS subscribed_project (
        project_id TEXT PRIMARY KEY
      );
    `);
  }
}
