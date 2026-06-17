// Dashboard WebSocket client. ONE per browser tab — owned by DashboardView /
// DashboardEdit. Reconnects with backoff. Auth: session cookie set by Better
// Auth — the browser sends it automatically on the WebSocket upgrade.

import type { WsClientMsg, WsServerMsg } from './types';

export type WsHandler = (msg: WsServerMsg) => void;
export type WsOptions = {
  // Resume on reconnect with a `?since=` cursor (server replies with a delta). The
  // handler must understand `delta` frames; the editor leaves this off.
  resumable?: boolean;
};

export class DashboardWs {
  private socket: WebSocket | null = null;
  private url: string;
  private handler: WsHandler;
  private backoffMs = 500;
  private closed = false;
  private resumable: boolean;
  private lastTs: number | null = null;

  constructor(dashboardId: string, handler: WsHandler, opts: WsOptions = {}) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${proto}//${location.host}/ws/${dashboardId}`;
    this.handler = handler;
    this.resumable = opts.resumable ?? false;
  }

  start(): void {
    this.closed = false;
    this.connect();
  }

  stop(): void {
    this.closed = true;
    this.socket?.close();
    this.socket = null;
  }

  send(msg: WsClientMsg): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  private connect(): void {
    // Reconnect: ask only for data newer than our cursor (server falls back to a
    // full snapshot if it has aged out).
    const url =
      this.resumable && this.lastTs != null ? `${this.url}?since=${this.lastTs}` : this.url;
    const ws = new WebSocket(url);
    this.socket = ws;

    ws.addEventListener('open', () => {
      this.backoffMs = 500;
    });

    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(typeof e.data === 'string' ? e.data : '') as WsServerMsg;
        this.trackCursor(msg);
        this.handler(msg);
      } catch {
        // ignore
      }
    });

    ws.addEventListener('close', () => {
      this.socket = null;
      if (this.closed) return;
      const delay = Math.min(15_000, this.backoffMs);
      this.backoffMs = Math.min(15_000, this.backoffMs * 2);
      setTimeout(() => this.connect(), delay);
    });

    ws.addEventListener('error', () => {
      ws.close();
    });
  }

  // Newest ts applied, so a reconnect can resume from it. Series arrays are sorted
  // ascending, so the last element is the max.
  private trackCursor(msg: WsServerMsg): void {
    if (!this.resumable) return;
    let max = this.lastTs ?? 0;
    if (msg.type === 'update' || msg.type === 'updates') {
      if (msg.ts > max) max = msg.ts;
    } else if (msg.type === 'snapshot' || msg.type === 'delta') {
      for (const col of Object.values(msg.series)) {
        const last = col.t[col.t.length - 1];
        if (last != null && last > max) max = last;
      }
      for (const v of Object.values(msg.variables)) {
        if (v.received_at > max) max = v.received_at;
      }
    }
    if (max > 0) this.lastTs = max;
  }
}
