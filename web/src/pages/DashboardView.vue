<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { useRoute } from 'vue-router';
import { useProjectStore } from '../stores/project';
import { DashboardWs } from '../ws';
import {
  buildDataIndex,
  applyProps,
  createWidgetElement,
  type DataIndex,
} from '../builder/render-widget';
import type {
  Dashboard,
  Layout,
  SnapshotMsg,
  UpdateMsg,
  WsServerMsg,
} from '../types';

const route = useRoute();
const project = useProjectStore();

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
    // Child components mount before parent's onMounted in Vue 3, so
    // ProjectShell may not have set currentProjectId yet on a fresh load.
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
  // Use the snapshot's per-device state + series to populate widgets.
  if (!idx.value || !dashboard.value) return;

  for (const item of dashboard.value.layout.items) {
    const el = els.value.get(item.id);
    if (!el) continue;
    applyProps(el, item); // ensure attributes are up to date

    if (item.type === 'iot-chart') {
      const seriesArr = (item.props['series'] as Array<Record<string, unknown>> | undefined) ?? [];
      const built = seriesArr.map((s) => {
        const device = String(s['device'] ?? '');
        const metric = String(s['metric'] ?? '');
        const pts = (snap.devices[device]?.series ?? [])
          .filter((p) => p.metric === metric)
          .map((p) => ({ ts: p.ts, value: numericOrNaN(p.value) }))
          .filter((p) => Number.isFinite(p.value));
        return {
          key: `${device}|${metric}`,
          label: typeof s['label'] === 'string' ? s['label'] : `${device}.${metric}`,
          color: typeof s['color'] === 'string' ? s['color'] : undefined,
          points: pts,
        };
      });
      (el as HTMLElement & { series?: unknown }).series = built;
    } else {
      const device = String(item.props['device'] ?? '');
      const metric = String(item.props['metric'] ?? '');
      const latest = snap.devices[device]?.state[metric];
      if (latest !== undefined) {
        (el as HTMLElement & { value?: unknown; ts?: number }).value = latest.value;
        (el as HTMLElement & { value?: unknown; ts?: number }).ts = latest.received_at;
      }
    }
  }
}

function applyUpdate(u: UpdateMsg) {
  if (!idx.value) return;
  const key = `${u.device}|${u.metric}`;
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
      (el as HTMLElement & { current?: unknown }).current = u.value;
    } else {
      (el as HTMLElement & { value?: unknown; ts?: number }).value = u.value;
      (el as HTMLElement & { value?: unknown; ts?: number }).ts = u.ts;
    }
  }
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
  const detail = (e as CustomEvent<{ device: string; name: string; value: unknown }>).detail;
  if (!detail?.device || !detail?.name) return;
  ws?.send({
    type: 'command',
    device: detail.device,
    name: detail.name,
    value: detail.value,
  });
}
</script>

<template>
  <main class="flex h-full flex-col">
    <header class="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
      <div>
        <h2 class="text-lg font-semibold tracking-tight">{{ dashboard?.name ?? 'Loading...' }}</h2>
        <p class="font-mono text-xs text-neutral-500">{{ dashboard?.id }}</p>
      </div>
      <RouterLink
        v-if="dashboard"
        :to="`/p/${project.currentProjectId}/d/${dashboard.id}/edit`"
        class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
      >Edit</RouterLink>
    </header>
    <div v-if="error" class="p-6 text-sm text-red-600">{{ error }}</div>
    <div ref="gridContainer" class="flex-1 overflow-auto p-6"></div>
  </main>
</template>
