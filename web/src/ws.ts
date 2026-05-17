// Dashboard WebSocket client. ONE per browser tab — owned by DashboardView /
// DashboardEdit. Reconnects with backoff. Auth: CF Access cookie in prod;
// in dev, append ?dev_email=... so the worker's dev bypass can pick it up.
//
// Important: this file is imported by the dashboard pages, NOT by widgets.
// Widgets stay framework-agnostic and have no transport knowledge (plan §9).

import type { WsClientMsg, WsServerMsg } from './types';
import { getDevEmail } from './api';

export type WsHandler = (msg: WsServerMsg) => void;

export class DashboardWs {
  private socket: WebSocket | null = null;
  private url: string;
  private handler: WsHandler;
  private backoffMs = 500;
  private closed = false;

  constructor(dashboardId: string, handler: WsHandler) {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const dev = getDevEmail();
    const qs = dev ? `?dev_email=${encodeURIComponent(dev)}` : '';
    this.url = `${proto}//${location.host}/ws/${dashboardId}${qs}`;
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
    const dev = getDevEmail();
    // The browser can't set custom headers on WebSocket; the dev bypass arrives via the
    // query string. The worker's verifyAccessJwt reads request headers, so we set up
    // the dev-mode bypass via a small middleware tweak in the worker.
    void dev;

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
