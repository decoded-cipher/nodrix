<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { GridLayout, GridItem } from 'grid-layout-plus';
import { useProjectStore } from '../../stores/project';
import { toast } from '../../lib/toast';
import { specFor } from '../../builder/widget-catalog';
import { GRID_COLUMNS, ROW_HEIGHT_EDIT, GRID_MARGIN, MIN_UNITS, normalizeLayout } from '../../builder/grid';
import WidgetPalette from '../../builder/WidgetPalette.vue';
import WidgetConfigPanel from '../../builder/WidgetConfigPanel.vue';
import { applyProps, createWidgetElement, buildDataIndex, subscriptionVariable, type DataIndex } from '../../builder/render-widget';
import { effectiveMobileLayout } from '../../builder/mobile-layout';
import { DashboardWs } from '../../ws';
import type { Dashboard, Layout, WidgetInstance, WidgetType, WsServerMsg, SnapshotMsg, UpdateMsg } from '../../types';

const route = useRoute();
const router = useRouter();
const project = useProjectStore();

const dashboard = ref<Dashboard | null>(null);
const layout = ref<Layout>({ grid: { columns: GRID_COLUMNS }, items: [] });
const selectedId = ref<string | null>(null);
const saving = ref(false);
const dirty = ref(false);
const err = ref<string | null>(null);

// The phone override lives in layout.value.mobile (null until customized).
const viewMode = ref<'desktop' | 'mobile'>('desktop');
// Below lg the widget palette is an off-canvas drawer; this is its open state.
const paletteOpen = ref(false);

// What's rendered/edited now. The phone layout shares widget ids + props with
// desktop, so everything below works unchanged on whichever is active.
const activeLayout = computed<Layout>(() =>
  viewMode.value === 'mobile' ? effectiveMobileLayout(layout.value) : layout.value
);

const widgetEls = shallowRef<Map<string, HTMLElement>>(new Map());
// Cached subscription index — rebuilt only when the layout/elements change
// (in syncWidgetElements), not on every incoming WS update.
const idxCache = shallowRef<DataIndex | null>(null);
let ws: DashboardWs | null = null;

// Project layout.items into grid-layout-plus's shape. One-way bind because
// grid-layout-plus 1.x emits `layout-updated` on drag/resize, NOT
// `update:layout` — so v-model:layout silently doesn't work. We listen to
// layout-updated explicitly via onGridLayoutUpdated() below.
const gridItems = computed(() =>
  activeLayout.value.items.map((it) => ({
    i: it.id,
    x: it.x,
    y: it.y,
    w: it.w,
    h: it.h,
  }))
);

type GridShape = { i: string; x: number; y: number; w: number; h: number };

function onLayoutUpdated(newLayout: GridShape[]) {
  if (viewMode.value === 'mobile') onMobileLayoutUpdated(newLayout);
  else onGridLayoutUpdated(newLayout);
}

// First phone edit turns the auto-derived layout into a saved override.
function onMobileLayoutUpdated(newLayout: GridShape[]) {
  const cur = activeLayout.value;
  const map = new Map(newLayout.map((g) => [g.i, g] as const));
  const same = cur.items.every((it) => {
    const g = map.get(it.id);
    return g && g.x === it.x && g.y === it.y && g.w === it.w && g.h === it.h;
  });
  if (same) return;
  const items = cur.items.map((it) => {
    const g = map.get(it.id);
    return g
      ? { id: it.id, x: g.x, y: g.y, w: g.w, h: g.h }
      : { id: it.id, x: it.x, y: it.y, w: it.w, h: it.h };
  });
  layout.value = { ...layout.value, mobile: { items } };
  dirty.value = true;
}

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

function setViewMode(mode: 'desktop' | 'mobile') {
  if (viewMode.value === mode) return;
  selectedId.value = null;
  viewMode.value = mode;
}

// Revert the phone layout to the auto-derived arrangement.
function resetMobileLayout() {
  if (!layout.value.mobile) return;
  layout.value = { ...layout.value, mobile: null };
  selectedId.value = null;
  dirty.value = true;
}

onMounted(async () => {
  const projId = route.params['proj'] as string;
  const dashId = route.params['dash'] as string;
  try {
    // Child mounts before parent's onMounted in Vue 3 — make sure the
    // project context exists before any project-scoped fetch.
    await project.switchTo(projId);
    dashboard.value = await project.fetchDashboard(dashId);
    // Upscale legacy 12-col layouts to the current resolution (idempotent).
    layout.value = normalizeLayout(dashboard.value.layout);
    dirty.value = false;
  } catch {
    err.value = 'This dashboard could not be loaded. It may have been removed, or you may not have access to it.';
    return;
  }

  await project.loadVariables();

  ws = new DashboardWs(dashId, handleMessage);
  ws.start();
});

onBeforeUnmount(() => {
  ws?.stop();
});

// Every layout mutation reassigns a fresh object (add/remove/move/resize/
// config-edit/save), and switching modes / editing the override recomputes
// activeLayout — so a shallow watch fires on each change, no deep tree walk.
watch(activeLayout, () => syncWidgetElements(), { flush: 'post' });

function syncWidgetElements() {
  // After each render of grid items, ensure each .widget-host has the right
  // custom element instance and updated attributes.
  for (const it of activeLayout.value.items) {
    const host = document.querySelector(`[data-host="${it.id}"]`) as HTMLElement | null;
    if (!host) continue;
    let el = widgetEls.value.get(it.id);
    if (!el || el.tagName.toLowerCase() !== it.type) {
      host.innerHTML = '';
      el = createWidgetElement(it);
      host.appendChild(el);
      widgetEls.value.set(it.id, el);
    } else {
      // Re-attach if the host was recreated (the grid re-mounts on Desktop<->Mobile).
      if (el.parentElement !== host) {
        host.innerHTML = '';
        host.appendChild(el);
      }
      applyProps(el, it);
    }
  }
  // Clean up stale
  const ids = new Set(activeLayout.value.items.map((i) => i.id));
  for (const id of [...widgetEls.value.keys()]) {
    if (!ids.has(id)) widgetEls.value.delete(id);
  }
  // Refresh the subscription index now that elements + props are current.
  idxCache.value = buildDataIndex(activeLayout.value, widgetEls.value);
}

function handleMessage(msg: WsServerMsg) {
  if (msg.type === 'snapshot') applySnapshot(msg);
  else if (msg.type === 'update') applyUpdate(msg);
}

function applySnapshot(snap: SnapshotMsg) {
  for (const item of activeLayout.value.items) {
    const el = widgetEls.value.get(item.id);
    if (!el) continue;
    if (item.type === 'iot-chart') {
      const series = (item.props['series'] as Array<Record<string, unknown>> | undefined) ?? [];
      (el as HTMLElement & { series?: unknown }).series = series.map((s) => {
        const variable = String(s['variable'] ?? '');
        const pts = snap.series
          .filter((p) => p.variable === variable)
          .map((p) => ({ ts: p.ts, value: Number(p.value) }))
          .filter((p) => Number.isFinite(p.value));
        return {
          key: variable,
          label: typeof s['label'] === 'string' ? s['label'] : variable,
          color: typeof s['color'] === 'string' ? s['color'] : undefined,
          points: pts,
        };
      });
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
  // Reuse the cached index; fall back to a build if an update lands before the
  // first post-layout sync has run.
  const idx = idxCache.value ?? buildDataIndex(activeLayout.value, widgetEls.value);
  const targets = idx.byKey.get(u.variable);
  if (!targets) return;
  for (const el of targets) {
    if (el.tagName === 'IOT-CHART') {
      const itemId = [...widgetEls.value.entries()].find(([, e]) => e === el)?.[0];
      const sk = itemId ? idx.chartKeys.get(itemId)?.get(u.variable) : null;
      if (sk && Number.isFinite(Number(u.value))) {
        (el as HTMLElement & {
          appendPoint?: (k: string, p: { ts: number; value: number }) => void;
        }).appendPoint?.(sk, { ts: u.ts, value: Number(u.value) });
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

function newWidgetId(): string {
  return `w_${Math.random().toString(36).slice(2, 10)}`;
}

// Leftmost (x, y) where a w×h widget fits without overlapping — packs
// horizontally first, then wraps to the next row.
function placeFor(w: number, h: number): { x: number; y: number } {
  const cols = layout.value.grid.columns;
  const items = layout.value.items;
  for (let y = 0; y < 1000; y++) {
    for (let x = 0; x + w <= cols; x++) {
      const overlaps = items.some(
        (it) => x < it.x + it.w && x + w > it.x && y < it.y + it.h && y + h > it.y
      );
      if (!overlaps) return { x, y };
    }
  }
  return { x: 0, y: 0 };
}

function addWidget(type: WidgetType) {
  const spec = specFor(type);
  const id = newWidgetId();
  const { w, h } = spec.defaultSize;
  const { x, y } = placeFor(w, h);
  layout.value = {
    ...layout.value,
    items: [...layout.value.items, { id, x, y, w, h, type, props: { ...spec.defaultProps } }],
  };
  selectedId.value = id;
  dirty.value = true;
  paletteOpen.value = false; // close the drawer so the new widget is visible
}

function duplicateItem(id: string) {
  const src = layout.value.items.find((it) => it.id === id);
  if (!src) return;
  const newId = newWidgetId();
  const { x, y } = placeFor(src.w, src.h);
  // Deep-clone props so the copy's markers/series arrays are independent.
  const props = JSON.parse(JSON.stringify(src.props)) as Record<string, unknown>;
  layout.value = {
    ...layout.value,
    items: [...layout.value.items, { ...src, id: newId, x, y, props }],
  };
  selectedId.value = newId;
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
  try {
    const updated = await project.saveDashboard(
      dashboard.value.id,
      layout.value,
      dashboard.value.updated_at
    );
    dashboard.value = updated;
    layout.value = normalizeLayout(updated.layout);
    dirty.value = false;
  } catch (e) {
    toast.error((e as Error).message);
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
    <WidgetPalette
      v-if="viewMode === 'desktop'"
      :open="paletteOpen"
      @add="addWidget"
      @close="paletteOpen = false"
    />

    <div class="relative flex flex-1 flex-col">
      <!-- Topbar actions. Labels collapse to icon-only below sm to keep the
           header uncluttered on phones; sm+ shows icon + text. -->
      <Teleport to="#topbar-actions" defer>
        <div class="mr-1 inline-flex items-center rounded-md border border-neutral-300 p-0.5 dark:border-neutral-700">
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm"
            :class="viewMode === 'desktop' ? 'bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'"
            title="Desktop layout"
            @click="setViewMode('desktop')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
            <span class="hidden sm:inline">Desktop</span>
          </button>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded px-2 py-1 text-sm"
            :class="viewMode === 'mobile' ? 'bg-neutral-200 font-medium text-neutral-900 dark:bg-neutral-700 dark:text-neutral-100' : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'"
            title="Phone layout"
            @click="setViewMode('mobile')"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><rect x="7" y="2" width="10" height="20" rx="2" /><path d="M11 18h2" /></svg>
            <span class="hidden sm:inline">Mobile</span>
          </button>
        </div>
        <button
          v-if="viewMode === 'mobile'"
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          :disabled="!layout.mobile"
          :class="layout.mobile ? '' : 'cursor-not-allowed opacity-50'"
          title="Reset layout — revert the phone layout to the auto-generated arrangement"
          @click="resetMobileLayout"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5" /></svg>
          <span class="hidden sm:inline">Reset layout</span>
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-2.5 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          title="Done"
          @click="exitToView"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M20 6 9 17l-5-5" /></svg>
          <span class="hidden sm:inline">Done</span>
        </button>
        <button
          class="inline-flex items-center gap-1.5 rounded-md bg-accent-600 px-2.5 py-1.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
          :disabled="!dirty || saving"
          :title="saving ? 'Saving…' : 'Save'"
          @click="save"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /><path d="M17 21v-8H7v8M7 3v5h8" /></svg>
          <span class="hidden sm:inline">{{ saving ? 'Saving…' : 'Save' }}</span>
        </button>
      </Teleport>

      <div v-if="err" class="bg-red-50 px-6 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">{{ err }}</div>

      <div class="canvas-dots flex-1 overflow-auto p-6 select-none" @click="selectedId = null">
        <p
          v-if="viewMode === 'mobile'"
          class="mx-auto mb-3 max-w-[412px] text-center text-xs text-neutral-500 dark:text-neutral-400"
        >Phone layout (&lt;768px). Drag to customize; widget settings are edited in Desktop.</p>
        <p
          v-else
          class="mb-3 text-xs text-neutral-500 lg:hidden dark:text-neutral-400"
        >Desktop layout — scroll to pan. Switch to Mobile to arrange the phone view.</p>
        <!-- Below lg the desktop grid renders at a true desktop width and pans
             (so widgets keep proper proportions instead of being squished); lg+
             fills the canvas responsively. Mobile uses a centered phone frame. -->
        <div
          :class="viewMode === 'mobile'
            ? 'mx-auto w-full max-w-[412px] rounded-2xl border border-neutral-300 bg-white p-2 shadow-sm dark:border-neutral-700 dark:bg-neutral-900'
            : 'min-w-[1280px] lg:min-w-0'"
        >
        <!-- :key remounts the grid on toggle so it re-measures the phone frame width. -->
        <GridLayout
          :key="viewMode"
          :layout="gridItems"
          :col-num="activeLayout.grid.columns"
          :row-height="ROW_HEIGHT_EDIT"
          :is-draggable="true"
          :is-resizable="true"
          :margin="[GRID_MARGIN, GRID_MARGIN]"
          :use-css-transforms="true"
          @layout-updated="onLayoutUpdated"
        >
          <GridItem
            v-for="g in gridItems"
            :key="g.i"
            :i="g.i"
            :x="g.x"
            :y="g.y"
            :w="g.w"
            :h="g.h"
            :min-w="MIN_UNITS"
            :min-h="MIN_UNITS"
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
                @click.stop
              >
                <span class="drag-grip"></span>
                <span class="drag-grip"></span>
                <span class="drag-grip"></span>
              </div>
            </div>
          </GridItem>
        </GridLayout>
        </div>
      </div>

      <WidgetConfigPanel
        v-if="viewMode === 'desktop'"
        :item="selected"
        @update="updateItem"
        @remove="removeItem"
        @duplicate="duplicateItem"
        @close="selectedId = null"
      />

      <!-- Opens the palette drawer (below lg). Pinned bottom-right and always on
           top so it stays reachable while panning or configuring a widget. -->
      <button
        v-if="viewMode === 'desktop'"
        type="button"
        class="absolute bottom-4 right-4 z-40 inline-flex items-center gap-1.5 rounded-full bg-accent-600 px-4 py-2.5 text-sm font-semibold text-white shadow-lg hover:bg-accent-700 lg:hidden"
        @click="paletteOpen = true"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4"><path d="M12 5v14M5 12h14" /></svg>
        Widgets
      </button>
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
