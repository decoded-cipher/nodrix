// Builds a configured custom-element instance for a widget. Shared by view
// and edit modes so layout JSON renders identically in both.
//
// Widget contract (plan §9): data in via property/attribute, intent out via
// `iot-command` events. NEVER imports api.ts or ws.ts.

import type { Layout, WidgetInstance } from '../types';

export type DataIndex = {
  // (device|metric) -> set of widget element instances that should receive updates
  byKey: Map<string, Set<HTMLElement>>;
  // (widgetId) -> the series-key mapping (for chart appendPoint dispatch)
  chartKeys: Map<string, Map<string, string>>; // widgetId -> (device|metric -> seriesKey)
};

export function buildDataIndex(layout: Layout, els: Map<string, HTMLElement>): DataIndex {
  const byKey = new Map<string, Set<HTMLElement>>();
  const chartKeys = new Map<string, Map<string, string>>();

  const addSub = (el: HTMLElement, device: string, metric: string) => {
    const key = `${device}|${metric}`;
    let set = byKey.get(key);
    if (!set) { set = new Set(); byKey.set(key, set); }
    set.add(el);
  };

  for (const item of layout.items) {
    const el = els.get(item.id);
    if (!el) continue;

    if (item.type === 'iot-chart') {
      const series = (item.props['series'] as Array<Record<string, unknown>> | undefined) ?? [];
      const m = new Map<string, string>();
      for (const s of series) {
        const device = String(s['device'] ?? '');
        const metric = String(s['metric'] ?? '');
        if (!device || !metric) continue;
        const sk = seriesKey(device, metric);
        m.set(`${device}|${metric}`, sk);
        addSub(el, device, metric);
      }
      chartKeys.set(item.id, m);
    } else if (item.type !== 'iot-push') {
      // iot-push is fire-and-forget — no state to subscribe to.
      // Everything else subscribes to (device, subscriptionMetric):
      //   value / gauge → the explicit `metric` prop
      //   toggle / slider → the `command` prop, so the device echoes state
      //     under the same name it receives commands on.
      const device = String(item.props['device'] ?? '');
      const metric = subscriptionMetric(item);
      if (device && metric) addSub(el, device, metric);
    }
  }

  return { byKey, chartKeys };
}

export function createWidgetElement(item: WidgetInstance): HTMLElement {
  const el = document.createElement(item.type);
  applyProps(el, item);
  return el;
}

export function applyProps(el: HTMLElement, item: WidgetInstance): void {
  const p = item.props;
  if (typeof p['title'] === 'string') el.setAttribute('data-title', p['title']);
  if (typeof p['unit'] === 'string') el.setAttribute('data-unit', p['unit']);
  if (typeof p['device'] === 'string') el.setAttribute('data-device', p['device']);
  if (typeof p['command'] === 'string') el.setAttribute('data-command', p['command']);
  if (typeof p['min'] === 'number') el.setAttribute('data-min', String(p['min']));
  if (typeof p['max'] === 'number') el.setAttribute('data-max', String(p['max']));
  if (typeof p['step'] === 'number') el.setAttribute('data-step', String(p['step']));
  if (typeof p['onValue'] === 'string') el.setAttribute('data-on-value', p['onValue']);
  if (typeof p['offValue'] === 'string') el.setAttribute('data-off-value', p['offValue']);
  if (typeof p['value'] === 'string') el.setAttribute('data-value', p['value']);
  if (typeof p['label'] === 'string') el.setAttribute('data-label', p['label']);
  if (typeof p['orientation'] === 'string') el.setAttribute('data-orientation', p['orientation']);
  if (typeof p['chartType'] === 'string') el.setAttribute('data-chart-type', p['chartType']);
  if (typeof p['zoom'] === 'boolean') el.setAttribute('data-zoom', p['zoom'] ? 'true' : 'false');

  if (item.type === 'iot-chart') {
    const series = (p['series'] as Array<Record<string, unknown>> | undefined) ?? [];
    (el as HTMLElement & { series?: unknown }).series = series.map((s) => ({
      key: seriesKey(String(s['device'] ?? ''), String(s['metric'] ?? '')),
      label: typeof s['label'] === 'string' ? s['label'] : `${String(s['device'])}.${String(s['metric'])}`,
      color: typeof s['color'] === 'string' ? s['color'] : undefined,
      points: [],
    }));
  }
}

export function seriesKey(device: string, metric: string): string {
  return `${device}|${metric}`;
}

// Which metric name a widget subscribes to for state. Control widgets
// (toggle/slider) reuse their `command` name so the device can echo state
// under the same name it receives commands on — no separate field needed.
export function subscriptionMetric(item: WidgetInstance): string {
  if (item.type === 'iot-toggle' || item.type === 'iot-slider') {
    return String(item.props['command'] ?? '');
  }
  return String(item.props['metric'] ?? '');
}
