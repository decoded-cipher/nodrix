<script setup lang="ts">
// Public, unauthenticated dashboard viewer. Two route entry points share this
// component: /share/:token (standalone page with a slim header) and
// /embed/:token (chrome-stripped, transparent, for iframes; ?item=<id> renders
// a single widget full-bleed). Read-only — control widgets are shown disabled.
//
// Data: fetch the layout once, then POLL /state on an interval. The public side
// never opens the dashboard WebSocket (that stays session-gated for members).
//
// Page states: loading → (loaded | notfound | failed). "notfound" (404) means a
// wrong token or sharing turned off — including revocation mid-view, caught on
// the next poll. "failed" is a transient error and offers a retry.

import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useDashboardGrid } from '../../composables/useDashboardGrid';
import { useIsPhone } from '../../composables/useViewport';
import { effectiveMobileLayout } from '../../builder/mobile-layout';
import { publicApi, PublicApiError } from '../../lib/public-api';
import type { CompactSeries, Layout, PublicDashboard, PublicState } from '../../types';

const route = useRoute();
const grid = useDashboardGrid();

const container = ref<HTMLElement | null>(null);
const name = ref('');
const status = ref<'loading' | 'ready' | 'notfound' | 'failed'>('loading');

const token = route.params['token'] as string;
const isEmbed = computed(() => route.name === 'public-embed');
const onlyItem = computed(() => {
  const q = route.query['item'];
  return typeof q === 'string' && q ? q : undefined;
});

let layout: Layout | null = null;          // desktop layout (with nested .mobile)
let lastState: PublicState | null = null;  // accumulated full state, re-applied on remount
let lastTs: number | null = null;          // newest series ts held; drives delta `since`
let ticker: ReturnType<typeof setInterval> | undefined;

// Auto-refresh cadence (seconds). Owner-set and server-clamped, delivered in the
// layout payload — NOT a URL param — so viewers can't override it to poll faster.
const refreshSecs = ref(5);
const secondsToRefresh = ref(refreshSecs.value);
const countdownLabel = computed(() => {
  const s = secondsToRefresh.value;
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
});

// Below 768px render the phone layout (override if set, else auto-derived).
const isPhone = useIsPhone();
function currentLayout(): Layout | null {
  if (!layout) return null;
  return isPhone.value ? effectiveMobileLayout(layout) : layout;
}

function mountGrid(): void {
  const lay = currentLayout();
  if (!container.value || !lay) return;
  grid.mount(container.value, lay, { onlyItem: onlyItem.value, controlsDisabled: true });
  if (lastState) grid.applySnapshot(lay, lastState.variables, lastState.series);
}

onMounted(() => {
  void load();
  document.addEventListener('visibilitychange', onVisibility);
});

// Remount when the desktop<->phone breakpoint flips, preserving the last state.
watch(isPhone, () => {
  if (status.value === 'ready') mountGrid();
});

onBeforeUnmount(() => {
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibility);
});

async function load() {
  status.value = 'loading';
  lastState = null;
  lastTs = null; // force the next poll to fetch a full snapshot
  try {
    const d = await publicApi.get<PublicDashboard>(`/v1/public/dashboards/${token}`);
    name.value = d.name;
    layout = d.layout;
    refreshSecs.value = d.layout.refresh ?? 5; // server-clamped
    status.value = 'ready';
    // Wait a tick so the container is rendered before mounting the grid.
    await Promise.resolve();
    mountGrid();
    await poll();
    startPolling();
  } catch (e) {
    status.value = e instanceof PublicApiError && e.status === 404 ? 'notfound' : 'failed';
  }
}

function startPolling() {
  stopPolling();
  secondsToRefresh.value = refreshSecs.value;
  // One 1s ticker drives both the countdown and the poll, so "next refresh in"
  // is exact and polling matches the chosen cadence.
  ticker = setInterval(() => {
    if (secondsToRefresh.value <= 1) {
      secondsToRefresh.value = refreshSecs.value;
      void poll();
    } else {
      secondsToRefresh.value -= 1;
    }
  }, 1000);
}

function stopPolling() {
  if (ticker) clearInterval(ticker);
  ticker = undefined;
}

// Client-side history cap, mirrors the chart's own #maxPoints.
const SERIES_CLIENT_CAP = 600;

async function poll() {
  if (!layout || document.hidden) return;
  try {
    // First poll fetches the full snapshot; afterwards send a `since` quantized to
    // the refresh cadence so only new points come back AND concurrent viewers
    // (who all hold the same newest ts) share one edge-cache entry per bucket.
    const bucket = Math.max(1, refreshSecs.value);
    const qs = lastTs != null ? `?since=${Math.floor(lastTs / bucket) * bucket}` : '';
    const s = await publicApi.get<PublicState>(`/v1/public/dashboards/${token}/state${qs}`);
    const lay = currentLayout();
    if (lastTs == null) {
      lastState = s;
      if (lay) grid.applySnapshot(lay, s.variables, s.series);
    } else {
      lastState = mergeDelta(lastState, s);
      if (lay) grid.applyDelta(lay, s.variables, s.series);
    }
    lastTs = maxSeriesTs(lastState.series) ?? lastTs;
  } catch (e) {
    // Sharing revoked mid-view → switch to the unavailable state and stop.
    // Other (transient) errors keep the last good render and retry next tick.
    if (e instanceof PublicApiError && e.status === 404) {
      status.value = 'notfound';
      stopPolling();
    }
  }
}

// Fold a delta response into the accumulated full state so a breakpoint remount
// (which re-applies lastState) keeps the full chart history.
function mergeDelta(prev: PublicState | null, next: PublicState): PublicState {
  const series: CompactSeries = { ...(prev?.series ?? {}) };
  for (const [variable, col] of Object.entries(next.series)) {
    const cur = series[variable] ?? { t: [], v: [] };
    const t = cur.t.slice();
    const v = cur.v.slice();
    const last = t.length ? t[t.length - 1]! : -Infinity;
    for (let i = 0; i < col.t.length; i++) {
      if (col.t[i]! > last) {
        t.push(col.t[i]!);
        v.push(col.v[i]!);
      }
    }
    series[variable] =
      t.length > SERIES_CLIENT_CAP
        ? { t: t.slice(-SERIES_CLIENT_CAP), v: v.slice(-SERIES_CLIENT_CAP) }
        : { t, v };
  }
  return { variables: next.variables, series };
}

function maxSeriesTs(series: CompactSeries): number | null {
  let max: number | null = null;
  for (const col of Object.values(series)) {
    const t = col.t[col.t.length - 1];
    if (t !== undefined && (max === null || t > max)) max = t;
  }
  return max;
}

// Resume immediately when a hidden tab/embed becomes visible again, instead of
// waiting up to a full interval.
function onVisibility() {
  if (!document.hidden && status.value === 'ready') {
    secondsToRefresh.value = refreshSecs.value;
    void poll();
  }
}
</script>

<template>
  <main :class="isEmbed ? 'flex h-full w-full flex-col bg-transparent' : 'flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950'">
    <header
      v-if="!isEmbed && status === 'ready'"
      class="flex items-center justify-between border-b border-neutral-200 px-4 py-3 sm:px-6 dark:border-neutral-800"
    >
      <h1 class="truncate text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{{ name }}</h1>
      <div class="ml-3 flex shrink-0 items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
        <span class="inline-flex items-center gap-1.5">
          <!-- Live pulse: a solid dot with a radiating wave. -->
          <span class="relative flex h-2 w-2">
            <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex h-2 w-2 rounded-full bg-emerald-500"></span>
          </span>
          <span class="hidden sm:inline">Live · read-only</span>
        </span>
        <span class="tabular-nums">Next refresh in {{ countdownLabel }}</span>
      </div>
    </header>

    <!-- Loading -->
    <div v-if="status === 'loading'" class="flex flex-1 items-center justify-center p-6">
      <span class="inline-flex items-center gap-2 text-sm text-neutral-400 dark:text-neutral-500">
        <svg class="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="9" stroke="currentColor" stroke-width="3" />
          <path class="opacity-90" d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="3" stroke-linecap="round" />
        </svg>
        Loading…
      </span>
    </div>

    <!-- Unavailable (404 / unshared) and transient failure both render a centered card. -->
    <div v-else-if="status === 'notfound' || status === 'failed'" class="flex flex-1 items-center justify-center p-6">
      <div class="max-w-xs text-center">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
          <svg v-if="status === 'notfound'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6">
            <path d="M9.5 14.5l5-5" />
            <path d="M7.5 11.5l-1.7 1.7a3.2 3.2 0 0 0 4.5 4.5l1.7-1.7" />
            <path d="M16.5 12.5l1.7-1.7a3.2 3.2 0 0 0-4.5-4.5l-1.7 1.7" />
            <path d="M3.5 3.5l17 17" />
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6">
            <path d="M12 8.5v4.5" />
            <path d="M12 16.5h.01" />
            <circle cx="12" cy="12" r="8.5" />
          </svg>
        </div>
        <h1 class="mt-4 text-base font-semibold text-neutral-900 dark:text-neutral-100">
          {{ status === 'notfound' ? 'Dashboard unavailable' : 'Couldn’t load dashboard' }}
        </h1>
        <p class="mt-1.5 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          {{ status === 'notfound'
            ? 'This link may be incorrect, or the dashboard is no longer shared.'
            : 'Something went wrong loading this dashboard. Check your connection and try again.' }}
        </p>
        <button
          v-if="status === 'failed'"
          type="button"
          class="mt-4 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="load"
        >Try again</button>
      </div>
    </div>

    <!-- Grid. v-show (not v-if) so the container ref exists before we mount into it. -->
    <div
      v-show="status === 'ready'"
      ref="container"
      :class="['flex-1 overflow-auto', onlyItem ? 'p-0' : isEmbed ? 'p-3' : 'p-6']"
    ></div>
  </main>
</template>
