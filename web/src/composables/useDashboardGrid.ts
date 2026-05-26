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
  applyLiveUpdate,
  applySnapshotItem,
  applySnapshotDelta,
  type DataIndex,
} from '../builder/render-widget';
import { manifestFor, type WidgetType } from '@nodrix/widgets-shared';
import { ROW_HEIGHT_VIEW, GRID_MARGIN, normalizeLayout } from '../builder/grid';
import type { CompactSeries, Layout, SnapshotMsg, UpdateMsg } from '../types';

// Widgets that write back to hardware. In read-only contexts (public shares,
// embeds) they still reflect reported state but must not be operable. Driven
// by each widget's manifest.category.
function isControl(type: string): boolean {
  return manifestFor(type as WidgetType).category === 'Control';
}

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
    const full = normalizeLayout(raw);
    const layout: Layout = opts.onlyItem
      ? { ...full, items: full.items.filter((i) => i.id === opts.onlyItem) }
      : full;

    container.innerHTML = '';

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

  // Initial load / remount: fill every widget from latest values + series.
  // applyProps is skipped for items whose snapshot kind is seriesPrePopulate
  // (its `series` property setter would wipe the history we're rebuilding).
  function applySnapshot(
    layout: Layout,
    variables: SnapshotMsg['variables'],
    series: CompactSeries
  ): void {
    if (!idx.value) return;
    for (const item of layout.items) {
      const el = els.value.get(item.id);
      if (!el) continue;
      if (manifestFor(item.type as WidgetType).runtime.snapshot.kind !== 'seriesPrePopulate') {
        applyProps(el, item);
      }
      applySnapshotItem(el, item, variables, series);
    }
  }

  // Steady-state poll: append new chart points, refresh other widgets from
  // latest values. Chart dedupe by ts in the widget keeps overlap harmless.
  function applyDelta(
    layout: Layout,
    variables: SnapshotMsg['variables'],
    series: CompactSeries
  ): void {
    if (!idx.value) return;
    for (const item of layout.items) {
      const el = els.value.get(item.id);
      if (!el) continue;
      const km = idx.value.chartKeys.get(item.id);
      const handledAsDelta = applySnapshotDelta(el, item, series, km);
      if (handledAsDelta) continue;
      applyProps(el, item);
      applySnapshotItem(el, item, variables, series);
    }
  }

  function applyUpdate(u: UpdateMsg): void {
    if (!idx.value) return;
    const targets = idx.value.byKey.get(u.variable);
    if (!targets) return;
    for (const el of targets) {
      const type = el.tagName.toLowerCase();
      const km = chartKeyMapFor(el);
      applyLiveUpdate(el, type, u, km);
    }
  }

  function applyReadonly(cell: HTMLElement, type: string, disabled?: boolean): void {
    if (disabled && isControl(type)) {
      cell.style.pointerEvents = 'none';
      cell.style.opacity = '0.7';
      cell.title = 'Read-only';
    }
  }

  function chartKeyMapFor(el: HTMLElement): Map<string, string> | undefined {
    if (!idx.value) return undefined;
    for (const [id, candidate] of els.value) {
      if (candidate === el) return idx.value.chartKeys.get(id);
    }
    return undefined;
  }

  return { els, idx, mount, applySnapshot, applyDelta, applyUpdate };
}
