<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { useProjectStore } from '../../stores/project';
import { useSessionStore } from '../../stores/session';
import { DashboardWs } from '../../ws';
import {
  buildDataIndex,
  applyProps,
  createWidgetElement,
  subscriptionVariable,
  type DataIndex,
} from '../../builder/render-widget';
import type {
  Dashboard,
  Layout,
  SnapshotMsg,
  UpdateMsg,
  WsServerMsg,
} from '../../types';

const route = useRoute();
const project = useProjectStore();
const session = useSessionStore();

// Viewers can watch a dashboard but can't edit it (or control devices — the
// server rejects control frames; we just hide the affordance).
const canEdit = computed(() => {
  const projId = route.params['proj'] as string;
  return session.projects.find((p) => p.id === projId)?.role === 'admin';
});

const dashboard = ref<Dashboard | null>(null);
const error = ref<string | null>(null);
const gridContainer = ref<HTMLElement | null>(null);
const els = shallowRef<Map<string, HTMLElement>>(new Map());
const idx = shallowRef<DataIndex | null>(null);
let ws: DashboardWs | null = null;

onMounted(async () => {
  const projId = route.params['proj'] as string;
  const dashId = route.params['dash'] as string;
  try {
    await project.switchTo(projId);
    dashboard.value = await project.fetchDashboard(dashId);
    mountGrid(dashboard.value.layout);
  } catch (e) {
    error.value = (e as Error).message;
    return;
  }

  ws = new DashboardWs(dashId, handleMessage);
  ws.start();

  // Listen for command events from any iot-toggle (delegated, document-level
  // because shadow DOM events bubble out when dispatched with composed:true).
  document.addEventListener('iot-command', onCommand as EventListener);
});

onBeforeUnmount(() => {
  ws?.stop();
  document.removeEventListener('iot-command', onCommand as EventListener);
});

function mountGrid(layout: Layout) {
  const root = gridContainer.value!;
  root.innerHTML = '';
  root.style.display = 'grid';
  root.style.gridTemplateColumns = `repeat(${layout.grid.columns}, 1fr)`;
  root.style.gridAutoRows = '90px';
  root.style.gap = '12px';

  // Compact y positions: legacy dashboards may have y=999 (placeholder from
  // the editor) which would render off-screen. Sort by (y, x), then drop each
  // item into the lowest row where it doesn't overlap an already-placed one.
  const placed: Array<{ x: number; y: number; w: number; h: number; src: typeof layout.items[number] }> = [];
  const sorted = [...layout.items].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const item of sorted) {
    let y = 0;
    while (placed.some((p) =>
      item.x < p.x + p.w && item.x + item.w > p.x &&
      y < p.y + p.h && y + item.h > p.y
    )) {
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
    cell.appendChild(widget);
    root.appendChild(cell);
    m.set(p.src.id, widget);
  }
  els.value = m;
  idx.value = buildDataIndex(layout, m);
}

function handleMessage(msg: WsServerMsg) {
  if (msg.type === 'snapshot') applySnapshot(msg);
  else if (msg.type === 'update') applyUpdate(msg);
}

function applySnapshot(snap: SnapshotMsg) {
  // The page-side authoritative layout already came from the REST fetch.
  // Use the snapshot's variable state + series to populate widgets.
  if (!idx.value || !dashboard.value) return;

  for (const item of dashboard.value.layout.items) {
    const el = els.value.get(item.id);
    if (!el) continue;
    applyProps(el, item); // ensure attributes are up to date

    if (item.type === 'iot-chart') {
      const seriesArr = (item.props['series'] as Array<Record<string, unknown>> | undefined) ?? [];
      const built = seriesArr.map((s) => {
        const variable = String(s['variable'] ?? '');
        const pts = snap.series
          .filter((p) => p.variable === variable)
          .map((p) => ({ ts: p.ts, value: numericOrNaN(p.value) }))
          .filter((p) => Number.isFinite(p.value));
        return {
          key: variable,
          label: typeof s['label'] === 'string' ? s['label'] : variable,
          color: typeof s['color'] === 'string' ? s['color'] : undefined,
          points: pts,
        };
      });
      (el as HTMLElement & { series?: unknown }).series = built;
    } else if (item.type === 'iot-map') {
      const m = el as HTMLElement & { updateVar?: (k: string, v: unknown, ts: number) => void };
      for (const key of mapVariableKeys(item)) {
        const latest = snap.variables[key];
        if (latest !== undefined) m.updateVar?.(key, latest.value, latest.received_at);
      }
    } else {
      const variable = subscriptionVariable(item);
      if (!variable) continue;
      const latest = snap.variables[variable];
      if (latest !== undefined) {
        (el as HTMLElement & { value?: unknown; ts?: number }).value = latest.value;
        (el as HTMLElement & { value?: unknown; ts?: number }).ts = latest.received_at;
      }
    }
  }
}

function applyUpdate(u: UpdateMsg) {
  if (!idx.value) return;
  const key = u.variable;
  const targets = idx.value.byKey.get(key);
  if (!targets) return;
  for (const el of targets) {
    if (el.tagName === 'IOT-CHART') {
      const chartItemId = findChartIdForKey(el);
      const sk = chartItemId ? idx.value.chartKeys.get(chartItemId)?.get(key) : null;
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

// Variable keys a map widget subscribes to (lat/lng of live markers + any
// value variable). Mirrors the subscription logic in buildDataIndex.
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

function numericOrNaN(v: unknown): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function onCommand(e: Event) {
  const detail = (e as CustomEvent<{ variable: string; value: unknown }>).detail;
  if (!detail?.variable) return;
  ws?.send({
    type: 'control',
    variable: detail.variable,
    value: detail.value,
  });
}
</script>

<template>
  <main class="flex h-full flex-col">
    <header class="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3 dark:border-neutral-800 dark:bg-neutral-900">
      <div>
        <h2 class="text-lg font-semibold tracking-tight">{{ dashboard?.name ?? 'Loading...' }}</h2>
        <p class="font-mono text-xs text-neutral-500 dark:text-neutral-400">{{ dashboard?.id }}</p>
      </div>
      <RouterLink
        v-if="dashboard && canEdit"
        :to="`/p/${project.currentProjectId}/d/${dashboard.id}/edit`"
        class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      >Edit</RouterLink>
    </header>
    <div v-if="error" class="p-6 text-sm text-red-600 dark:text-red-400">{{ error }}</div>
    <div ref="gridContainer" class="flex-1 overflow-auto p-6"></div>
  </main>
</template>
