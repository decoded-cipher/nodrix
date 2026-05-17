<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { GridLayout, GridItem } from 'grid-layout-plus';
import { useProjectStore } from '../stores/project';
import { specFor } from '../builder/widget-catalog';
import WidgetPalette from '../builder/WidgetPalette.vue';
import WidgetConfigPanel from '../builder/WidgetConfigPanel.vue';
import { applyProps, createWidgetElement, buildDataIndex } from '../builder/render-widget';
import { DashboardWs } from '../ws';
import type { Dashboard, Layout, WidgetInstance, WidgetType, WsServerMsg, SnapshotMsg, UpdateMsg } from '../types';

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

// Convert layout.items into a shape grid-layout-plus understands.
// We keep our `items` as the source of truth and project to/from grid format.
const gridItems = computed({
  get: () =>
    layout.value.items.map((it) => ({
      i: it.id,
      x: it.x,
      y: it.y,
      w: it.w,
      h: it.h,
    })),
  set: (val) => {
    const map = new Map(val.map((g) => [g.i, g] as const));
    layout.value = {
      ...layout.value,
      items: layout.value.items.map((it) => {
        const g = map.get(it.id);
        return g ? { ...it, x: g.x, y: g.y, w: g.w, h: g.h } : it;
      }),
    };
    dirty.value = true;
  },
});

const selected = computed(() => layout.value.items.find((it) => it.id === selectedId.value) ?? null);

onMounted(async () => {
  const dashId = route.params['dash'] as string;
  try {
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
      (el as HTMLElement & { current?: unknown }).current = u.value;
    } else {
      (el as HTMLElement & { value?: unknown; ts?: number }).value = u.value;
      (el as HTMLElement & { value?: unknown; ts?: number }).ts = u.ts;
    }
  }
}

function addWidget(type: WidgetType) {
  const spec = specFor(type);
  const id = `w_${Math.random().toString(36).slice(2, 10)}`;
  layout.value = {
    ...layout.value,
    items: [
      ...layout.value.items,
      {
        id,
        x: 0,
        y: 999, // grid-layout-plus auto-compacts
        w: spec.defaultSize.w,
        h: spec.defaultSize.h,
        type,
        props: { ...spec.defaultProps },
      },
    ],
  };
  selectedId.value = id;
  dirty.value = true;
}

function updateItem(next: WidgetInstance) {
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

    <div class="flex flex-1 flex-col">
      <header class="flex items-center justify-between border-b border-neutral-200 bg-white px-6 py-3">
        <div>
          <h2 class="text-lg font-semibold tracking-tight">{{ dashboard?.name ?? 'Loading...' }}</h2>
          <p class="text-xs text-neutral-500">
            {{ dirty ? 'Unsaved changes' : 'Up to date' }}
          </p>
        </div>
        <div class="flex items-center gap-2">
          <button
            class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100"
            @click="exitToView"
          >Done</button>
          <button
            class="rounded-md bg-orange-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
            :disabled="!dirty || saving"
            @click="save"
          >{{ saving ? 'Saving...' : 'Save' }}</button>
        </div>
      </header>

      <div v-if="err" class="bg-red-50 px-6 py-2 text-sm text-red-700">{{ err }}</div>

      <div class="flex-1 overflow-auto bg-neutral-100 p-6">
        <GridLayout
          v-model:layout="gridItems"
          :col-num="layout.grid.columns"
          :row-height="80"
          :is-draggable="true"
          :is-resizable="true"
          :margin="[12, 12]"
          :use-css-transforms="true"
          class="rounded-md bg-white p-2"
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
              class="relative h-full overflow-hidden rounded-md border-2"
              :class="selectedId === g.i ? 'border-orange-500' : 'border-transparent'"
              @click="selectedId = g.i"
            >
              <div class="drag-handle absolute inset-x-0 top-0 z-10 h-4 cursor-move bg-neutral-200/40"></div>
              <div :data-host="g.i" class="h-full pt-4"></div>
            </div>
          </GridItem>
        </GridLayout>
      </div>
    </div>

    <WidgetConfigPanel :item="selected" @update="updateItem" @remove="removeItem" />
  </main>
</template>

<!-- grid-layout-plus injects its own styles on import; no explicit CSS needed. -->
