// Lightweight validator for the dashboard layout JSON. Mirrors the shape in
// web/src/builder/layout-schema.ts. Kept loose on purpose — widget props are
// validated client-side; the server just enforces the structural envelope so
// we never persist a layout that the renderer can't even iterate over.

export type WidgetType = 'iot-value' | 'iot-gauge' | 'iot-chart' | 'iot-toggle' | 'iot-push' | 'iot-slider' | 'iot-map';

const ALLOWED_TYPES: ReadonlySet<string> = new Set([
  'iot-value',
  'iot-gauge',
  'iot-chart',
  'iot-toggle',
  'iot-push',
  'iot-slider',
  'iot-map',
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

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

// Variable keys referenced by a layout. Charts use a `series` array of
// `{ variable }`; maps use a `markers` array of `{ latVar, lngVar, valueVar }`;
// every other widget uses a single `variable` prop.
export function variablesFromLayout(layout: Layout): string[] {
  const set = new Set<string>();
  for (const item of layout.items) {
    const props = item.props;
    if (item.type === 'iot-chart' && Array.isArray(props['series'])) {
      for (const s of props['series'] as Array<Record<string, unknown>>) {
        if (typeof s['variable'] === 'string') set.add(s['variable']);
      }
    } else if (item.type === 'iot-map' && Array.isArray(props['markers'])) {
      for (const m of props['markers'] as Array<Record<string, unknown>>) {
        if ((m['source'] ?? 'static') === 'variable') {
          if (typeof m['latVar'] === 'string') set.add(m['latVar']);
          if (typeof m['lngVar'] === 'string') set.add(m['lngVar']);
        }
        if (typeof m['valueVar'] === 'string') set.add(m['valueVar']);
      }
    } else if (typeof props['variable'] === 'string') {
      set.add(props['variable']);
    }
  }
  return [...set];
}
