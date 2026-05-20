// Builds a configured custom-element instance for a widget. Shared by view
// and edit modes so layout JSON renders identically in both.
//
// Widget contract: data in via property/attribute, intent out via
// `iot-command` events. NEVER imports api.ts or ws.ts.

import type { Layout, WidgetInstance } from '../types';

export type DataIndex = {
  // variable -> set of widget element instances that should receive updates
  byKey: Map<string, Set<HTMLElement>>;
  // (widgetId) -> the series-key mapping (for chart appendPoint dispatch)
  chartKeys: Map<string, Map<string, string>>; // widgetId -> (variable -> seriesKey)
};

export function buildDataIndex(layout: Layout, els: Map<string, HTMLElement>): DataIndex {
  const byKey = new Map<string, Set<HTMLElement>>();
  const chartKeys = new Map<string, Map<string, string>>();

  const addSub = (el: HTMLElement, variable: string) => {
    let set = byKey.get(variable);
    if (!set) { set = new Set(); byKey.set(variable, set); }
    set.add(el);
  };

  for (const item of layout.items) {
    const el = els.get(item.id);
    if (!el) continue;

    if (item.type === 'iot-chart') {
      const series = (item.props['series'] as Array<Record<string, unknown>> | undefined) ?? [];
      const m = new Map<string, string>();
      for (const s of series) {
        const variable = String(s['variable'] ?? '');
        if (!variable) continue;
        m.set(variable, seriesKey(variable));
        addSub(el, variable);
      }
      chartKeys.set(item.id, m);
    } else if (item.type !== 'iot-push') {
      // iot-push is fire-and-forget — no state to subscribe to. Everything
      // else subscribes to its single `variable` prop. Control widgets
      // (toggle/slider) reflect the reported state of the same variable they
      // write to.
      const variable = subscriptionVariable(item);
      if (variable) addSub(el, variable);
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
  if (typeof p['variable'] === 'string') el.setAttribute('data-variable', p['variable']);
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
      key: seriesKey(String(s['variable'] ?? '')),
      label: typeof s['label'] === 'string' ? s['label'] : String(s['variable'] ?? ''),
      color: typeof s['color'] === 'string' ? s['color'] : undefined,
      points: [],
    }));
  }
}

export function seriesKey(variable: string): string {
  return variable;
}

// Which variable a widget subscribes to for state. All widgets use a single
// `variable` prop; control widgets (toggle/slider) reflect the reported state
// of the same variable they write to.
export function subscriptionVariable(item: WidgetInstance): string {
  return String(item.props['variable'] ?? '');
}
