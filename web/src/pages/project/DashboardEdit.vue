<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { GridLayout, GridItem } from 'grid-layout-plus';
import { useProjectStore } from '../../stores/project';
import { specFor } from '../../builder/widget-catalog';
import WidgetPalette from '../../builder/WidgetPalette.vue';
import WidgetConfigPanel from '../../builder/WidgetConfigPanel.vue';
import { applyProps, createWidgetElement, buildDataIndex } from '../../builder/render-widget';
import { DashboardWs } from '../../ws';
import type { Dashboard, Layout, WidgetInstance, WidgetType, WsServerMsg, SnapshotMsg, UpdateMsg } from '../../types';

const route = useRoute();
const router = useRouter();
const project = useProjectStore();

const dashboard = ref<Dashboard | null>(null);
const layout = ref<Layout>({ grid: { columns: 12 }, items: [] });
const selectedId = ref<string | null>(null);
const saving = ref(false);
const dirty = ref(false);
const err = ref<string | null>(null);

const widgetEls = shallowRef<Map<string, HTMLElement>>(new Map());
let ws: DashboardWs | null = null;

// Project layout.items into grid-layout-plus's shape. One-way bind because
// grid-layout-plus 1.x emits `layout-updated` on drag/resize, NOT
// `update:layout` — so v-model:layout silently doesn't work. We listen to
// layout-updated explicitly via onGridLayoutUpdated() below.
const gridItems = computed(() =>
  layout.value.items.map((it) => ({
    i: it.id,
    x: it.x,
    y: it.y,
    w: it.w,
    h: it.h,
  }))
);

type GridShape = { i: string; x: number; y: number; w: number; h: number };

function onGridLayoutUpdated(newLayout: GridShape[]) {
  const map = new Map(newLayout.map((g) => [g.i, g] as const));
  let changed = false;
  const newItems = layout.value.items.map((it) => {
    const g = map.get(it.id);
    if (!g) return it;
    if (g.x !== it.x || g.y !== it.y || g.w !== it.w || g.h !== it.h) {
      changed = true;
      return { ...it, x: g.x, y: g.y, w: g.w, h: g.h };
    }
    return it;
  });
  if (changed) {
    layout.value = { ...layout.value, items: newItems };
    dirty.value = true;
  }
}

const selected = computed(() => layout.value.items.find((it) => it.id === selectedId.value) ?? null);

onMounted(async () => {
  const projId = route.params['proj'] as string;
  const dashId = route.params['dash'] as string;
  try {
    // Child mounts before parent's onMounted in Vue 3 — make sure the
    // project context exists before any project-scoped fetch.
    await project.switchTo(projId);
    dashboard.value = await project.fetchDashboard(dashId);
    layout.value = dashboard.value.layout;
    dirty.value = false;
  } catch (e) {
    err.value = (e as Error).message;
    return;
  }

  await project.loadDevices();

  ws = new DashboardWs(dashId, handleMessage);
  ws.start();
});

onBeforeUnmount(() => {
  ws?.stop();
});

watch(layout, () => syncWidgetElements(), { deep: true, flush: 'post' });

function syncWidgetElements() {
  // After each render of grid items, ensure each .widget-host has the right
  // custom element instance and updated attributes.
  for (const it of layout.value.items) {
    const host = document.querySelector(`[data-host="${it.id}"]`) as HTMLElement | null;
    if (!host) continue;
    let el = widgetEls.value.get(it.id);
    if (!el || el.tagName.toLowerCase() !== it.type) {
      host.innerHTML = '';
      el = createWidgetElement(it);
      host.appendChild(el);
      widgetEls.value.set(it.id, el);
    } else {
      applyProps(el, it);
    }
  }
  // Clean up stale
  const ids = new Set(layout.value.items.map((i) => i.id));
  for (const id of [...widgetEls.value.keys()]) {
    if (!ids.has(id)) widgetEls.value.delete(id);
  }
}

function handleMessage(msg: WsServerMsg) {
  if (msg.type === 'snapshot') applySnapshot(msg);
  else if (msg.type === 'update') applyUpdate(msg);
}

function applySnapshot(snap: SnapshotMsg) {
  for (const item of layout.value.items) {
    const el = widgetEls.value.get(item.id);
    if (!el) continue;
    if (item.type === 'iot-chart') {
      const series = (item.props['series'] as Array<Record<string, unknown>> | undefined) ?? [];
      (el as HTMLElement & { series?: unknown }).series = series.map((s) => {
        const device = String(s['device'] ?? '');
        const metric = String(s['metric'] ?? '');
        const pts = (snap.devices[device]?.series ?? [])
          .filter((p) => p.metric === metric)
          .map((p) => ({ ts: p.ts, value: Number(p.value) }))
          .filter((p) => Number.isFinite(p.value));
        return {
          key: `${device}|${metric}`,
          label: typeof s['label'] === 'string' ? s['label'] : `${device}.${metric}`,
          color: typeof s['color'] === 'string' ? s['color'] : undefined,
          points: pts,
        };
      });
    } else if (item.type !== 'iot-toggle') {
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
  const idx = buildDataIndex(layout.value, widgetEls.value);
  const targets = idx.byKey.get(`${u.device}|${u.metric}`);
  if (!targets) return;
  for (const el of targets) {
    if (el.tagName === 'IOT-CHART') {
      const itemId = [...widgetEls.value.entries()].find(([, e]) => e === el)?.[0];
      const sk = itemId ? idx.chartKeys.get(itemId)?.get(`${u.device}|${u.metric}`) : null;
      if (sk && Number.isFinite(Number(u.value))) {
        (el as HTMLElement & {
          appendPoint?: (k: string, p: { ts: number; value: number }) => void;
        }).appendPoint?.(sk, { ts: u.ts, value: Number(u.value) });
      }
    } else if (el.tagName === 'IOT-TOGGLE') {
      (el as HTMLElement & { current?: unknown; ts?: number }).current = u.value;
      (el as HTMLElement & { current?: unknown; ts?: number }).ts = u.ts;
    } else {
      (el as HTMLElement & { value?: unknown; ts?: number }).value = u.value;
      (el as HTMLElement & { value?: unknown; ts?: number }).ts = u.ts;
    }
  }
}

function addWidget(type: WidgetType) {
  const spec = specFor(type);
  const id = `w_${Math.random().toString(36).slice(2, 10)}`;
  const w = spec.defaultSize.w;
  const h = spec.defaultSize.h;
  const cols = layout.value.grid.columns;
  const items = layout.value.items;
  // Pack horizontally first, then wrap. Find leftmost (x, y) that fits.
  let placedX = 0;
  let placedY = 0;
  outer: for (let y = 0; y < 1000; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const overlaps = items.some(
        (it) =>
          x < it.x + it.w &&
          x + w > it.x &&
          y < it.y + it.h &&
          y + h > it.y
      );
      if (!overlaps) {
        placedX = x;
        placedY = y;
        break outer;
      }
    }
  }
  layout.value = {
    ...layout.value,
    items: [
      ...items,
      {
        id,
        x: placedX,
        y: placedY,
        w,
        h,
        type,
        props: { ...spec.defaultProps },
      },
    ],
  };
  selectedId.value = id;
  dirty.value = true;
}

function updateItem(next: WidgetInstance) {
  const prev = layout.value.items.find((it) => it.id === next.id);
  // Swap w/h when a slider's orientation flips — a 4×2 horizontal slider
  // should become a 2×4 vertical one, so the user doesn't have to manually
  // re-shape the widget after switching orientation.
  if (
    prev &&
    next.type === 'iot-slider' &&
    prev.props['orientation'] !== next.props['orientation']
  ) {
    next = { ...next, w: next.h, h: next.w };
  }
  layout.value = {
    ...layout.value,
    items: layout.value.items.map((it) => (it.id === next.id ? next : it)),
  };
  dirty.value = true;
}

function removeItem(id: string) {
  layout.value = {
    ...layout.value,
    items: layout.value.items.filter((it) => it.id !== id),
  };
  if (selectedId.value === id) selectedId.value = null;
  dirty.value = true;
}

async function save() {
  if (!dashboard.value) return;
  saving.value = true;
  err.value = null;
  try {
    const updated = await project.saveDashboard(
      dashboard.value.id,
      layout.value,
      dashboard.value.updated_at
    );
    dashboard.value = updated;
    layout.value = updated.layout;
    dirty.value = false;
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

function exitToView() {
  if (dashboard.value) {
    router.push(`/p/${project.currentProjectId}/d/${dashboard.value.id}`);
  }
}
</script>

<template>
  <main class="flex h-full">
    <WidgetPalette @add="addWidget" />

    <div class="relative flex flex-1 flex-col">
      <Teleport to="#topbar-actions" defer>
        <button
          class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="exitToView"
        >Done</button>
        <button
          class="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          :disabled="!dirty || saving"
          @click="save"
        >{{ saving ? 'Saving...' : 'Save' }}</button>
      </Teleport>

      <div v-if="err" class="bg-red-50 px-6 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{{ err }}</div>

      <div class="canvas-dots flex-1 overflow-auto p-6 select-none" @click="selectedId = null">
        <GridLayout
          :layout="gridItems"
          :col-num="layout.grid.columns"
          :row-height="80"
          :is-draggable="true"
          :is-resizable="true"
          :margin="[12, 12]"
          :use-css-transforms="true"
          @layout-updated="onGridLayoutUpdated"
        >
          <GridItem
            v-for="g in gridItems"
            :key="g.i"
            :i="g.i"
            :x="g.x"
            :y="g.y"
            :w="g.w"
            :h="g.h"
            drag-allow-from=".drag-handle"
          >
            <div
              class="widget-frame group relative h-full rounded-[12px] transition-shadow"
              :class="selectedId === g.i ? 'is-selected' : ''"
              @click.stop="selectedId = g.i"
            >
              <div :data-host="g.i" class="h-full w-full"></div>
              <div
                class="drag-handle"
                role="button"
                title="Drag to move"
                aria-label="Drag widget"
              >
                <span class="drag-grip"></span>
                <span class="drag-grip"></span>
                <span class="drag-grip"></span>
              </div>
            </div>
          </GridItem>
        </GridLayout>
      </div>

      <WidgetConfigPanel
        :item="selected"
        @update="updateItem"
        @remove="removeItem"
        @close="selectedId = null"
      />
    </div>
  </main>
</template>

<style scoped>
.canvas-dots {
  background-color: var(--canvas-bg);
  background-image: radial-gradient(var(--canvas-dot) 1px, transparent 1px);
  background-size: 16px 16px;
  background-position: 0 0;
}

/* Widget frame: a transparent wrapper that gets a soft outline on hover
   and a stronger one when selected. The widget itself has its own border. */
.widget-frame {
  cursor: pointer;
}
.widget-frame::after {
  content: "";
  position: absolute;
  inset: -2px;
  border-radius: 12px;
  pointer-events: none;
  box-shadow: 0 0 0 0 transparent;
  transition: box-shadow 140ms ease;
}
.widget-frame:hover::after {
  box-shadow: 0 0 0 2px rgba(234, 88, 12, 0.25);
}
.widget-frame.is-selected::after {
  box-shadow: 0 0 0 2px #ea580c, 0 6px 24px -8px rgba(234, 88, 12, 0.45);
}

/* Drag handle — a centered grip pill on the top edge. Subtle by default,
   stronger on hover/selection. NOTE: keep this a <div>, not a <button>;
   interact.js (used by grid-layout-plus) doesn't reliably start drags
   from native button elements because the browser swallows mousedown for
   click activation. */
.drag-handle {
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 5;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 44px;
  height: 16px;
  border-radius: 9999px;
  background: rgba(23, 23, 23, 0.18);
  cursor: grab;
  opacity: 0.55;
  transition: opacity 140ms ease, background 140ms ease, transform 140ms ease;
  touch-action: none;
  user-select: none;
}
.widget-frame:hover .drag-handle,
.widget-frame.is-selected .drag-handle {
  opacity: 1;
  background: rgba(23, 23, 23, 0.65);
}
.drag-handle:hover {
  background: #ea580c !important;
  transform: translateX(-50%) translateY(-1px);
}
.drag-handle:active {
  cursor: grabbing;
  transform: translateX(-50%) scale(0.96);
}
.drag-grip {
  width: 3px;
  height: 3px;
  border-radius: 9999px;
  background: rgba(255, 255, 255, 0.95);
  pointer-events: none;
}

/* Custom resize handle in the bottom-right corner — replaces the default
   2-line corner from grid-layout-plus. Scoped via :deep to reach the
   GridLayout's internal element. */
:deep(.vgl-layout) {
  --vgl-resizer-size: 18px;
  --vgl-placeholder-bg: #ea580c;
  --vgl-placeholder-opacity: 14%;
}
:deep(.vgl-item__resizer) {
  opacity: 0;
  transition: opacity 140ms ease;
}
:deep(.vgl-item__resizer::before) {
  display: none;
}
:deep(.vgl-item__resizer::after) {
  content: "";
  position: absolute;
  right: 4px;
  bottom: 4px;
  width: 12px;
  height: 12px;
  border-right: 2px solid #ea580c;
  border-bottom: 2px solid #ea580c;
  border-bottom-right-radius: 4px;
}
:deep(.vgl-item:hover .vgl-item__resizer),
:deep(.vgl-item--resizing .vgl-item__resizer) {
  opacity: 1;
}
:deep(.vgl-item--dragging),
:deep(.vgl-item--resizing) {
  cursor: grabbing;
}
</style>
