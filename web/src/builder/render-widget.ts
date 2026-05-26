// Generic widget renderer + dispatcher. Every per-widget detail lives in the
// manifest (web/src/widgets/<id>/manifest.json); nothing here switches on the
// widget type with a string literal.
//
// Widget contract: data in via property/attribute, intent out via
// `iot-command` events. NEVER imports api.ts or ws.ts.

import { manifestFor, type WidgetType } from '@nodrix/widgets-shared';
import { extractVariables, isChartSeriesExtractor } from '@nodrix/widgets-shared';
import type { CompactSeries, Layout, SnapshotMsg, UpdateMsg, WidgetInstance } from '../types';

export type DataIndex = {
  byKey: Map<string, Set<HTMLElement>>;
  chartKeys: Map<string, Map<string, string>>; // widgetId -> (variable -> seriesKey)
};

export function seriesKey(variable: string): string {
  return variable;
}

const toKebab = (s: string) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());

function numericOrNaN(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

export function extractItemVariables(item: WidgetInstance): string[] {
  return extractVariables(manifestFor(item.type as WidgetType), item.props);
}

// First subscribed variable for an item — used by control widgets that bind
// to exactly one variable (toggle/slider/value/gauge).
export function subscriptionVariable(item: WidgetInstance): string {
  return extractItemVariables(item)[0] ?? '';
}

export function buildDataIndex(layout: Layout, els: Map<string, HTMLElement>): DataIndex {
  const byKey = new Map<string, Set<HTMLElement>>();
  const chartKeys = new Map<string, Map<string, string>>();
  for (const item of layout.items) {
    const el = els.get(item.id);
    if (!el) continue;
    const m = manifestFor(item.type as WidgetType);
    const vars = extractVariables(m, item.props);
    for (const v of vars) {
      let set = byKey.get(v);
      if (!set) { set = new Set(); byKey.set(v, set); }
      set.add(el);
    }
    if (isChartSeriesExtractor(m.runtime.variableExtractor)) {
      const km = new Map<string, string>();
      for (const v of vars) km.set(v, seriesKey(v));
      chartKeys.set(item.id, km);
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
  const m = manifestFor(item.type as WidgetType);
  const p = item.props;

  for (const a of m.bindings.attributes) {
    const prop = String(a['prop']);
    const t = String(a['type']);
    const v = p[prop];
    if (typeof v !== t) continue;
    const attr = typeof a['attr'] === 'string' ? String(a['attr']) : `data-${toKebab(prop)}`;
    el.setAttribute(attr, t === 'boolean' ? (v ? 'true' : 'false') : String(v));
  }

  for (const pr of m.bindings.properties) {
    const prop = String(pr['prop']);
    const as = String(pr['as']);
    const transform = String(pr['transform']);
    const v = p[prop];
    const target = el as unknown as Record<string, unknown>;
    if (transform === 'seriesArray') {
      const arr = (Array.isArray(v) ? v : []) as Array<Record<string, unknown>>;
      const keyField = String(pr['keyField'] ?? 'variable');
      const labelField = String(pr['labelField'] ?? 'label');
      const colorField = String(pr['colorField'] ?? 'color');
      target[as] = arr.map((s) => ({
        key: String(s[keyField] ?? ''),
        label: typeof s[labelField] === 'string' ? s[labelField] : String(s[keyField] ?? ''),
        color: typeof s[colorField] === 'string' ? s[colorField] : undefined,
        points: [],
      }));
    } else {
      target[as] = Array.isArray(v) ? v : (v ?? []);
    }
  }
}

// Dispatch one live variable update to one element instance.
// chartKeyMap is the variable->seriesKey map for this widget (from DataIndex).
export function applyLiveUpdate(
  el: HTMLElement,
  type: string,
  u: UpdateMsg,
  chartKeyMap?: Map<string, string>,
): void {
  const m = manifestFor(type as WidgetType);
  const lu = m.runtime.liveUpdate;
  switch (lu.kind) {
    case 'none':
      return;
    case 'valueProperty': {
      const e = el as HTMLElement & { value?: unknown; ts?: number };
      e.value = u.value;
      e.ts = u.ts;
      return;
    }
    case 'currentProperty': {
      const e = el as HTMLElement & { current?: unknown; ts?: number };
      e.current = u.value;
      e.ts = u.ts;
      return;
    }
    case 'appendPoint': {
      const method = String(lu['method'] ?? 'appendPoint');
      const sk = chartKeyMap?.get(u.variable);
      const n = numericOrNaN(u.value);
      if (sk && Number.isFinite(n)) {
        const fn = (el as unknown as Record<string, (k: string, p: { ts: number; value: number }) => void>)[method];
        if (typeof fn === 'function') fn.call(el, sk, { ts: u.ts, value: n });
      }
      return;
    }
    case 'updateVar': {
      const method = String(lu['method'] ?? 'updateVar');
      const fn = (el as unknown as Record<string, (k: string, v: unknown, ts: number) => void>)[method];
      if (typeof fn === 'function') fn.call(el, u.variable, u.value, u.ts);
      return;
    }
  }
}

// Initial fill on mount / on snapshot. `variables` is latest-value-per-key;
// `series` is the columnar chart history (used by seriesPrePopulate).
export function applySnapshotItem(
  el: HTMLElement,
  item: WidgetInstance,
  variables: SnapshotMsg['variables'],
  series: CompactSeries,
): void {
  const m = manifestFor(item.type as WidgetType);
  const sn = m.runtime.snapshot;
  switch (sn.kind) {
    case 'none':
      return;
    case 'valueProperty': {
      const variable = subscriptionVariable(item);
      if (!variable) return;
      const latest = variables[variable];
      if (latest !== undefined) {
        const e = el as HTMLElement & { value?: unknown; ts?: number };
        e.value = latest.value;
        e.ts = latest.received_at;
      }
      return;
    }
    case 'updateVar': {
      const method = String(sn['method'] ?? 'updateVar');
      const fn = (el as unknown as Record<string, (k: string, v: unknown, ts: number) => void>)[method];
      if (typeof fn !== 'function') return;
      for (const key of extractItemVariables(item)) {
        const latest = variables[key];
        if (latest !== undefined) fn.call(el, key, latest.value, latest.received_at);
      }
      return;
    }
    case 'seriesPrePopulate': {
      const prop = String(sn['prop'] ?? 'series');
      const arr = (item.props[prop] as Array<Record<string, unknown>> | undefined) ?? [];
      const built = arr.map((s) => {
        const variable = String(s['variable'] ?? '');
        const col = series[variable];
        const pts: Array<{ ts: number; value: number }> = [];
        if (col) {
          for (let i = 0; i < col.t.length; i++) {
            const value = numericOrNaN(col.v[i]);
            if (Number.isFinite(value)) pts.push({ ts: col.t[i]!, value });
          }
        }
        return {
          key: variable,
          label: typeof s['label'] === 'string' ? s['label'] : variable,
          color: typeof s['color'] === 'string' ? s['color'] : undefined,
          points: pts,
        };
      });
      (el as HTMLElement & { series?: unknown }).series = built;
    }
  }
}

// Append-only delta for chart-like widgets. Returns true if it handled the
// item, false otherwise — caller falls back to applySnapshotItem.
export function applySnapshotDelta(
  el: HTMLElement,
  item: WidgetInstance,
  series: CompactSeries,
  chartKeyMap?: Map<string, string>,
): boolean {
  const m = manifestFor(item.type as WidgetType);
  if (m.runtime.snapshot.kind !== 'seriesPrePopulate') return false;
  const prop = String((m.runtime.snapshot as Record<string, unknown>)['prop'] ?? 'series');
  const method = m.runtime.liveUpdate.kind === 'appendPoint'
    ? String((m.runtime.liveUpdate as Record<string, unknown>)['method'] ?? 'appendPoint')
    : 'appendPoint';
  const arr = (item.props[prop] as Array<Record<string, unknown>> | undefined) ?? [];
  const fn = (el as unknown as Record<string, (k: string, p: { ts: number; value: number }) => void>)[method];
  if (typeof fn !== 'function') return false;
  for (const s of arr) {
    const variable = String(s['variable'] ?? '');
    const col = series[variable];
    if (!col) continue;
    const sk = chartKeyMap?.get(variable) ?? variable;
    for (let i = 0; i < col.t.length; i++) {
      const v = numericOrNaN(col.v[i]);
      if (Number.isFinite(v)) fn.call(el, sk, { ts: col.t[i]!, value: v });
    }
  }
  return true;
}
