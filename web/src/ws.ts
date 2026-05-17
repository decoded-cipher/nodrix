// Dashboard WebSocket client. ONE per browser tab — owned by DashboardView /
// DashboardEdit. Reconnects with backoff. Auth: session cookie set by Better
// Auth — the browser sends it automatically on the WebSocket upgrade.

import type { WsClientMsg, WsServerMsg } from './types';

export type WsHandler = (msg: WsServerMsg) => void;

export class DashboardWs {
  private socket: WebSocket | null = null;
  private url: string;
  private handler: WsHandler;
  private backoffMs = 500;
  private closed = false;

  constructor(dashboardId: string, handler: WsHandler) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    this.url = `${proto}//${location.host}/ws/${dashboardId}`;
    this.handler = handler;
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
    const ws = new WebSocket(this.url);
    this.socket = ws;

    ws.addEventListener('open', () => {
      this.backoffMs = 500;
    });

    ws.addEventListener('message', (e) => {
      try {
        const msg = JSON.parse(typeof e.data === 'string' ? e.data : '') as WsServerMsg;
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
}
