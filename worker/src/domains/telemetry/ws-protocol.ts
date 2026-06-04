// Pure classifier for device→cloud frames on the control WebSocket. Keeping it
// pure (no DO/state) makes the accepted shapes unit-testable, and lets the DO's
// webSocketMessage handler stay a thin switch. Telemetry reuses parseTelemetryBody
// so HTTP and WS enforce the exact same caps/validation.

import { parseTelemetryBody } from './validate';
import type { IngestPoint } from '../../platform/durable-objects/project-do';

export type DeviceMessage =
  | { kind: 'ack'; ids: string[] }
  | { kind: 'telemetry'; points: IngestPoint[] }
  | { kind: 'event'; event: string; payload?: Record<string, unknown> }
  | { kind: 'error'; code: string; key?: string }
  | { kind: 'ignore' };

// Accepted frames: {type:"ack",ids:[…]}, {type:"telemetry",metrics:{…}} (also
// {type:"telemetry",metric,value}), {type:"event",event,payload?}. Anything else
// (unknown type, non-JSON, non-object) is ignored; invalid telemetry/event is an
// error the caller can echo back so a WS device gets HTTP-parity diagnostics.
export function parseDeviceMessage(raw: string): DeviceMessage {
  let msg: unknown;
  try {
    msg = JSON.parse(raw);
  } catch {
    return { kind: 'ignore' };
  }
  if (!msg || typeof msg !== 'object') return { kind: 'ignore' };
  const m = msg as Record<string, unknown>;

  switch (m.type) {
    case 'ack': {
      const ids = Array.isArray(m.ids) ? m.ids.filter((x): x is string => typeof x === 'string') : [];
      return { kind: 'ack', ids };
    }
    case 'telemetry': {
      const parsed = parseTelemetryBody(m); // reads m.metrics / m.metric+value
      if (!parsed.ok) {
        const key = 'key' in parsed.error ? parsed.error.key : undefined;
        return { kind: 'error', code: parsed.error.code, key };
      }
      return { kind: 'telemetry', points: parsed.points };
    }
    case 'event': {
      const event = typeof m.event === 'string' ? m.event.trim() : '';
      if (!event) return { kind: 'error', code: 'missing_event' };
      const payload =
        m.payload && typeof m.payload === 'object' && !Array.isArray(m.payload)
          ? (m.payload as Record<string, unknown>)
          : undefined;
      return { kind: 'event', event, payload };
    }
    default:
      return { kind: 'ignore' };
  }
}
