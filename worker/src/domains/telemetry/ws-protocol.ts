// Pure classifier for device→cloud WebSocket frames. Reuses parseTelemetryBody so HTTP
// and WS validate telemetry identically; staying pure keeps it unit-testable.

import { parseTelemetryBody } from './validate';
import type { IngestPoint } from '../../platform/durable-objects/project-do';

export type DeviceMessage =
  | { kind: 'ack'; ids: string[] }
  | { kind: 'telemetry'; points: IngestPoint[] }
  | { kind: 'event'; event: string; payload?: Record<string, unknown> }
  | { kind: 'error'; code: string; key?: string }
  | { kind: 'ignore' };

// Unknown type / non-JSON → ignore (dropped). Bad telemetry/event → error (the caller
// echoes it back so a WS device gets the same diagnostics HTTP returns).
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
