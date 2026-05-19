// Lightweight validator for the dashboard layout JSON. Mirrors the shape in
// web/src/builder/layout-schema.ts. Kept loose on purpose — widget props are
// validated client-side; the server just enforces the structural envelope so
// we never persist a layout that the renderer can't even iterate over.

export type WidgetType = 'iot-value' | 'iot-gauge' | 'iot-chart' | 'iot-toggle' | 'iot-push' | 'iot-slider';

const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'iot-value',
  'iot-gauge',
  'iot-chart',
  'iot-toggle',
  'iot-push',
  'iot-slider',
]);

export type WidgetInstance = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  type: WidgetType;
  props: Record<string, unknown>;
};

export type Layout = {
  grid: { columns: number };
  items: WidgetInstance[];
};

export function validateLayout(input: unknown): { ok: true; value: Layout } | { ok: false; reason: string } {
  if (!isObject(input)) return { ok: false, reason: 'layout must be an object' };
  const grid = input['grid'];
  if (!isObject(grid) || typeof grid['columns'] !== 'number') {
    return { ok: false, reason: 'layout.grid.columns must be a number' };
  }
  const items = input['items'];
  if (!Array.isArray(items)) return { ok: false, reason: 'layout.items must be an array' };

  for (const item of items) {
    if (!isObject(item)) return { ok: false, reason: 'each item must be an object' };
    for (const f of ['id', 'type'] as const) {
      if (typeof item[f] !== 'string') return { ok: false, reason: `item.${f} must be a string` };
    }
    for (const f of ['x', 'y', 'w', 'h'] as const) {
      if (typeof item[f] !== 'number') return { ok: false, reason: `item.${f} must be a number` };
    }
    if (!ALLOWED_TYPES.has(item['type'] as string)) {
      return { ok: false, reason: `unknown widget type: ${item['type'] as string}` };
    }
    if (!isObject(item['props'])) return { ok: false, reason: 'item.props must be an object' };
  }

  return {
    ok: true,
    value: {
      grid: { columns: grid['columns'] },
      items: items as WidgetInstance[],
    },
  };
}

// Extract (device, metric) pairs from a layout. Used by the Dashboard DO to
// figure out which Device DOs to subscribe to on connect.
export function devicesAndMetricsFromLayout(layout: Layout): Array<{ device: string; metric: string }> {
  const out: Array<{ device: string; metric: string }> = [];
  const seen = new Set<string>();

  for (const item of layout.items) {
    const props = item.props;
    if (item.type === 'iot-chart' && Array.isArray(props['series'])) {
      for (const s of props['series'] as Array<Record<string, unknown>>) {
        if (typeof s['device'] === 'string' && typeof s['metric'] === 'string') {
          push(s['device'], s['metric']);
        }
      }
    } else if (item.type === 'iot-toggle') {
      // Toggles write commands but also need device for the command target.
      // No metric subscription needed.
    } else {
      if (typeof props['device'] === 'string' && typeof props['metric'] === 'string') {
        push(props['device'], props['metric']);
      }
    }
  }
  return out;

  function push(device: string, metric: string) {
    const key = `${device}|${metric}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ device, metric });
  }
}

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// Devices referenced by a layout (for cross-project validation when saving).
export function devicesFromLayout(layout: Layout): string[] {
  const set = new Set<string>();
  for (const item of layout.items) {
    const props = item.props;
    if (item.type === 'iot-chart' && Array.isArray(props['series'])) {
      for (const s of props['series'] as Array<Record<string, unknown>>) {
        if (typeof s['device'] === 'string') set.add(s['device']);
      }
    } else if (typeof props['device'] === 'string') {
      set.add(props['device']);
    }
  }
  return [...set];
}
