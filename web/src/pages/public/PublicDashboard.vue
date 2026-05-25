<script setup lang="ts">
// Public, unauthenticated dashboard viewer. Two route entry points share this
// component: /share/:token (standalone page with a slim header) and
// /embed/:token (chrome-stripped, transparent, for iframes; ?item=<id> renders
// a single widget full-bleed). Read-only — control widgets are shown disabled.
//
// Data: fetch the layout once, then POLL /state on an interval. The public side
// never opens the dashboard WebSocket (that stays session-gated for members).

import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useDashboardGrid } from '../../composables/useDashboardGrid';
import { publicApi } from '../../lib/public-api';
import type { Layout, PublicDashboard, PublicState } from '../../types';

const route = useRoute();
const grid = useDashboardGrid();

const container = ref<HTMLElement | null>(null);
const name = ref('');
const error = ref<string | null>(null);
const loaded = ref(false);

const token = route.params['token'] as string;
const isEmbed = computed(() => route.name === 'public-embed');
const onlyItem = computed(() => {
  const q = route.query['item'];
  return typeof q === 'string' && q ? q : undefined;
});

// Poll cadence. Aligned to the /state edge-cache TTL (5s) so most polls collapse
// to a cached edge response.
const POLL_MS = 5000;
let layout: Layout | null = null;
let pollTimer: ReturnType<typeof setInterval> | undefined;

onMounted(async () => {
  try {
    const d = await publicApi.get<PublicDashboard>(`/v1/public/dashboards/${token}`);
    name.value = d.name;
    layout = d.layout;
    loaded.value = true;
    // Wait a tick so the container is in the DOM before mounting the grid.
    await Promise.resolve();
    if (container.value) {
      grid.mount(container.value, layout, {
        onlyItem: onlyItem.value,
        controlsDisabled: true,
      });
    }
    await poll();
    pollTimer = setInterval(poll, POLL_MS);
    document.addEventListener('visibilitychange', onVisibility);
  } catch {
    error.value = 'This dashboard is unavailable. The link may be incorrect, or sharing was turned off.';
  }
});

onBeforeUnmount(() => {
  if (pollTimer) clearInterval(pollTimer);
  document.removeEventListener('visibilitychange', onVisibility);
});

async function poll() {
  if (!layout || document.hidden) return;
  try {
    const s = await publicApi.get<PublicState>(`/v1/public/dashboards/${token}/state`);
    grid.applySnapshot(layout, s.variables, s.series);
  } catch {
    // Transient (e.g. brief edge hiccup) — keep the last good render.
  }
}

// Resume immediately when a hidden tab/embed becomes visible again, instead of
// waiting up to a full interval.
function onVisibility() {
  if (!document.hidden) void poll();
}
</script>

<template>
  <main :class="isEmbed ? 'h-full w-full bg-transparent' : 'min-h-screen bg-neutral-50 dark:bg-neutral-950'">
    <header
      v-if="!isEmbed && !error"
      class="flex items-center justify-between border-b border-neutral-200 px-6 py-3 dark:border-neutral-800"
    >
      <h1 class="text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{{ name }}</h1>
      <span class="inline-flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
        <span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
        Live · read-only
      </span>
    </header>

    <div v-if="error" class="p-6 text-sm text-red-600 dark:text-red-400">{{ error }}</div>

    <div
      v-show="loaded && !error"
      ref="container"
      :class="isEmbed ? 'h-full w-full overflow-auto p-3' : 'overflow-auto p-6'"
    ></div>
  </main>
</template>
