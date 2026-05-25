// Shared dashboard rendering: builds the widget grid and applies live data to
// it. Extracted from DashboardView so the authenticated viewer (fed by the
// WebSocket) and the public viewer (fed by polling /v1/public/.../state) render
// identically from the same layout JSON. The composable owns the DOM widget
// elements and the variable->element index; callers own their data source.

import { shallowRef } from 'vue';
import {
  buildDataIndex,
  applyProps,
  createWidgetElement,
  subscriptionVariable,
  type DataIndex,
} from '../builder/render-widget';
import { ROW_HEIGHT_VIEW, GRID_MARGIN, normalizeLayout } from '../builder/grid';
import type { CompactSeries, Layout, SnapshotMsg, UpdateMsg } from '../types';

// Widgets that write back to hardware. In read-only contexts (public shares,
// embeds) they still reflect reported state but must not be operable.
const CONTROL_TYPES = new Set(['iot-toggle', 'iot-slider', 'iot-push']);

export type MountOptions = {
  // Render only this widget id, full-bleed (single-widget embeds).
  onlyItem?: string;
  // Disable interaction on control widgets (read-only public/embed views).
  controlsDisabled?: boolean;
};

export function useDashboardGrid() {
  const els = shallowRef<Map<string, HTMLElement>>(new Map());
  const idx = shallowRef<DataIndex | null>(null);

  function mount(container: HTMLElement, raw: Layout, opts: MountOptions = {}): void {
    // Upscale legacy 12-col layouts to the current resolution (idempotent), so
    // the viewer matches the editor regardless of when it was last saved.
    const full = normalizeLayout(raw);
    const layout: Layout = opts.onlyItem
      ? { ...full, items: full.items.filter((i) => i.id === opts.onlyItem) }
      : full;

    container.innerHTML = '';

    // Single-widget embed: one cell filling the host frame, no grid math.
    if (opts.onlyItem) {
      container.style.display = 'block';
      const m = new Map<string, HTMLElement>();
      const item = layout.items[0];
      if (item) {
        const widget = createWidgetElement(item);
        container.style.height = '100%';
        widget.style.display = 'block';
        widget.style.height = '100%';
        applyReadonly(container, item.type, opts.controlsDisabled);
        container.appendChild(widget);
        m.set(item.id, widget);
      }
      els.value = m;
      idx.value = buildDataIndex(layout, m);
      return;
    }

    container.style.display = 'grid';
    container.style.gridTemplateColumns = `repeat(${layout.grid.columns}, 1fr)`;
    container.style.gridAutoRows = `${ROW_HEIGHT_VIEW}px`;
    container.style.gap = `${GRID_MARGIN}px`;

    // Compact y positions: legacy dashboards may have y=999 (editor placeholder)
    // which would render off-screen. Sort by (y, x), then drop each item into the
    // lowest row where it doesn't overlap an already-placed one.
    const placed: Array<{ x: number; y: number; w: number; h: number; src: Layout['items'][number] }> = [];
    const sorted = [...layout.items].sort((a, b) => a.y - b.y || a.x - b.x);
    for (const item of sorted) {
      let y = 0;
      while (
        placed.some(
          (p) =>
            item.x < p.x + p.w &&
            item.x + item.w > p.x &&
            y < p.y + p.h &&
            y + item.h > p.y
        )
      ) {
        y++;
      }
      placed.push({ x: item.x, y, w: item.w, h: item.h, src: item });
    }

    const m = new Map<string, HTMLElement>();
    for (const p of placed) {
      const widget = createWidgetElement(p.src);
      const cell = document.createElement('div');
      cell.style.gridColumnStart = String(p.x + 1);
      cell.style.gridColumnEnd = `span ${p.w}`;
      cell.style.gridRowStart = String(p.y + 1);
      cell.style.gridRowEnd = `span ${p.h}`;
      applyReadonly(cell, p.src.type, opts.controlsDisabled);
      cell.appendChild(widget);
      container.appendChild(cell);
      m.set(p.src.id, widget);
    }
    els.value = m;
    idx.value = buildDataIndex(layout, m);
  }

  // Apply a full snapshot (initial load, or the first public poll / a remount).
  // Charts are replaced wholesale; other widgets take their latest value.
  // `variables`/`series` mirror the WS SnapshotMsg shape.
  function applySnapshot(
    layout: Layout,
    variables: SnapshotMsg['variables'],
    series: CompactSeries
  ): void {
    if (!idx.value) return;
    for (const item of layout.items) {
      const el = els.value.get(item.id);
      if (!el) continue;
      // Charts are driven entirely by applyChartFull — do NOT call applyProps on
      // them here: its iot-chart branch resets the series to empty points, which
      // would blow away the history we're about to (or already) render.
      if (item.type === 'iot-chart') {
        applyChartFull(el, item, series);
      } else {
        applyProps(el, item); // keep attributes current
        applyLatest(el, item, variables);
      }
    }
  }

  // Apply an incremental delta (steady-state public poll): append only the new
  // chart points, refresh other widgets from the latest values. Charts dedupe by
  // ts, so a delta that overlaps points the client already has is harmless.
  function applyDelta(
    layout: Layout,
    variables: SnapshotMsg['variables'],
    series: CompactSeries
  ): void {
    if (!idx.value) return;
    for (const item of layout.items) {
      const el = els.value.get(item.id);
      if (!el) continue;
      // Same as applySnapshot: never applyProps a chart (it would wipe history);
      // a delta only appends the new points.
      if (item.type === 'iot-chart') {
        applyChartDelta(el, item, series);
      } else {
        applyProps(el, item);
        applyLatest(el, item, variables);
      }
    }
  }

  // Replace a chart's series from the compact columnar payload.
  function applyChartFull(el: HTMLElement, item: Layout['items'][number], series: CompactSeries): void {
    const seriesArr = (item.props['series'] as Array<Record<string, unknown>> | undefined) ?? [];
    const built = seriesArr.map((s) => {
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

  // Append new points to an existing chart, using the same series-key dispatch as
  // the WS update path so keys line up with what the chart was mounted with.
  function applyChartDelta(el: HTMLElement, item: Layout['items'][number], series: CompactSeries): void {
    const keyMap = idx.value?.chartKeys.get(item.id);
    const chartEl = el as HTMLElement & {
      appendPoint?: (k: string, p: { ts: number; value: number }) => void;
    };
    const seriesArr = (item.props['series'] as Array<Record<string, unknown>> | undefined) ?? [];
    for (const s of seriesArr) {
      const variable = String(s['variable'] ?? '');
      const col = series[variable];
      if (!col) continue;
      const sk = keyMap?.get(variable) ?? variable;
      for (let i = 0; i < col.t.length; i++) {
        const value = numericOrNaN(col.v[i]);
        if (Number.isFinite(value)) chartEl.appendPoint?.(sk, { ts: col.t[i]!, value });
      }
    }
  }

  // Push the latest value into a non-chart widget (map markers, gauges, toggles).
  function applyLatest(el: HTMLElement, item: Layout['items'][number], variables: SnapshotMsg['variables']): void {
    if (item.type === 'iot-map') {
      const m = el as HTMLElement & { updateVar?: (k: string, v: unknown, ts: number) => void };
      for (const key of mapVariableKeys(item)) {
        const latest = variables[key];
        if (latest !== undefined) m.updateVar?.(key, latest.value, latest.received_at);
      }
    } else {
      const variable = subscriptionVariable(item);
      if (!variable) return;
      const latest = variables[variable];
      if (latest !== undefined) {
        (el as HTMLElement & { value?: unknown; ts?: number }).value = latest.value;
        (el as HTMLElement & { value?: unknown; ts?: number }).ts = latest.received_at;
      }
    }
  }

  function applyUpdate(u: UpdateMsg): void {
    if (!idx.value) return;
    const targets = idx.value.byKey.get(u.variable);
    if (!targets) return;
    for (const el of targets) {
      if (el.tagName === 'IOT-CHART') {
        const chartItemId = findChartIdForKey(el);
        const sk = chartItemId ? idx.value.chartKeys.get(chartItemId)?.get(u.variable) : null;
        if (sk && Number.isFinite(numericOrNaN(u.value))) {
          (el as HTMLElement & {
            appendPoint?: (k: string, p: { ts: number; value: number }) => void;
          }).appendPoint?.(sk, { ts: u.ts, value: numericOrNaN(u.value) });
        }
      } else if (el.tagName === 'IOT-TOGGLE') {
        (el as HTMLElement & { current?: unknown; ts?: number }).current = u.value;
        (el as HTMLElement & { current?: unknown; ts?: number }).ts = u.ts;
      } else if (el.tagName === 'IOT-MAP') {
        (el as HTMLElement & { updateVar?: (k: string, v: unknown, ts: number) => void }).updateVar?.(
          u.variable,
          u.value,
          u.ts
        );
      } else {
        (el as HTMLElement & { value?: unknown; ts?: number }).value = u.value;
        (el as HTMLElement & { value?: unknown; ts?: number }).ts = u.ts;
      }
    }
  }

  function applyReadonly(cell: HTMLElement, type: string, disabled?: boolean): void {
    if (disabled && CONTROL_TYPES.has(type)) {
      cell.style.pointerEvents = 'none';
      cell.style.opacity = '0.7';
      cell.title = 'Read-only';
    }
  }

  function mapVariableKeys(item: { props: Record<string, unknown> }): string[] {
    const markers = (item.props['markers'] as Array<Record<string, unknown>> | undefined) ?? [];
    const keys = new Set<string>();
    for (const mk of markers) {
      if ((mk['source'] ?? 'static') === 'variable') {
        const lat = String(mk['latVar'] ?? '');
        const lng = String(mk['lngVar'] ?? '');
        if (lat) keys.add(lat);
        if (lng) keys.add(lng);
      }
      const value = String(mk['valueVar'] ?? '');
      if (value) keys.add(value);
    }
    return [...keys];
  }

  function findChartIdForKey(el: HTMLElement): string | null {
    for (const [id, candidate] of els.value) {
      if (candidate === el) return id;
    }
    return null;
  }

  return { els, idx, mount, applySnapshot, applyDelta, applyUpdate };
}

function numericOrNaN(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}
