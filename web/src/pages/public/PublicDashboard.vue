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
import { useThemeStore } from '../../stores/theme';
import type { CompactSeries, Layout, PublicDashboard, PublicState } from '../../types';

const route = useRoute();
const grid = useDashboardGrid();
const theme = useThemeStore();

const main = ref<HTMLElement | null>(null);
const container = ref<HTMLElement | null>(null);
const name = ref('');
const description = ref<string | null>(null);
const itemCount = ref(0);
const status = ref<'loading' | 'ready' | 'notfound' | 'failed'>('loading');

// A shared dashboard with no widgets would otherwise render as a blank page.
const isEmpty = computed(() => status.value === 'ready' && itemCount.value === 0);

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
const refreshing = ref(false);

// "Updated Xs ago" trust signal: newest data ts (received_at / series ts, both in
// seconds) measured against a `now` the 1s ticker keeps fresh.
const newestTs = ref<number | null>(null);
const nowSec = ref(Math.floor(Date.now() / 1000));
const updatedLabel = computed(() => {
  if (newestTs.value == null) return '';
  const diff = Math.max(0, nowSec.value - newestTs.value);
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
});

// Feed health for the pulse: two failed polls → offline; data not advancing → stale.
const failedPolls = ref(0);
const staleAfter = computed(() => Math.max(90, refreshSecs.value * 8));
const connection = computed<'live' | 'stale' | 'offline'>(() => {
  if (failedPolls.value >= 2) return 'offline';
  if (newestTs.value != null && nowSec.value - newestTs.value > staleAfter.value) return 'stale';
  return 'live';
});
const connectionUi = computed(() => {
  switch (connection.value) {
    case 'offline': return { label: 'Reconnecting…', dot: 'bg-neutral-400 dark:bg-neutral-500', ping: '' };
    case 'stale': return { label: 'Stale', dot: 'bg-amber-500', ping: '' };
    default: return { label: 'Live', dot: 'bg-emerald-500', ping: 'bg-emerald-400' };
  }
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
  document.addEventListener('fullscreenchange', onFullscreenChange);
});

// Remount when the desktop<->phone breakpoint flips, preserving the last state.
watch(isPhone, () => {
  if (status.value === 'ready') mountGrid();
});

onBeforeUnmount(() => {
  stopPolling();
  document.removeEventListener('visibilitychange', onVisibility);
  document.removeEventListener('fullscreenchange', onFullscreenChange);
});

async function load() {
  status.value = 'loading';
  lastState = null;
  lastTs = null; // force the next poll to fetch a full snapshot
  newestTs.value = null;
  try {
    const d = await publicApi.get<PublicDashboard>(`/v1/public/dashboards/${token}`);
    name.value = d.name;
    description.value = d.description;
    // Router's afterEach resets the title on navigation away, so no restore.
    if (!isEmbed.value) document.title = `${d.name} · nodrix`;
    layout = d.layout;
    itemCount.value = d.layout.items.length;
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
  // One 1s ticker drives the poll cadence AND keeps "updated Xs ago" current.
  ticker = setInterval(() => {
    nowSec.value = Math.floor(Date.now() / 1000);
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
    nowSec.value = Math.floor(Date.now() / 1000);
    newestTs.value = newestDataTs(lastState) ?? newestTs.value;
    failedPolls.value = 0;
  } catch (e) {
    // Revoked mid-view (404) → unavailable + stop. Transient errors keep the
    // last good render, mark the feed offline, and retry next tick.
    if (e instanceof PublicApiError && e.status === 404) {
      status.value = 'notfound';
      stopPolling();
    } else {
      failedPolls.value += 1;
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

// Newest data ts across latest values (received_at) and chart series — drives the
// "updated Xs ago" label. Both are in seconds, matching nowSec.
function newestDataTs(state: PublicState): number | null {
  let max = maxSeriesTs(state.series);
  for (const r of Object.values(state.variables)) {
    if (max === null || r.received_at > max) max = r.received_at;
  }
  return max;
}

// Viewer "refresh now": poll immediately and restart the countdown. The brief
// `refreshing` flag spins the button icon.
async function refreshNow() {
  if (refreshing.value) return;
  refreshing.value = true;
  secondsToRefresh.value = refreshSecs.value;
  try {
    await poll();
  } finally {
    refreshing.value = false;
  }
}

const isFullscreen = ref(false);
function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void main.value?.requestFullscreen().catch(() => {});
}
function onFullscreenChange() {
  isFullscreen.value = document.fullscreenElement != null;
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
  <main
    ref="main"
    :class="isEmbed ? 'flex h-full w-full flex-col bg-transparent' : 'flex min-h-screen flex-col bg-neutral-50 dark:bg-neutral-950'"
  >
    <header
      v-if="!isEmbed && !onlyItem && status === 'ready'"
      class="flex items-center justify-between gap-3 border-b border-neutral-200 px-4 py-2.5 sm:px-6 dark:border-neutral-800"
    >
      <div class="flex min-w-0 items-center gap-2.5">
        <!-- Bind to the theme so only one variant downloads: white mark on dark
             headers, dark-ink mark on light. -->
        <img
          :src="theme.resolved === 'dark' ? '/icon-192.png' : '/icon-dark-192.png'"
          alt="nodrix"
          class="h-7 w-7 shrink-0 object-contain"
        />
        <div class="min-w-0">
          <h1 class="truncate text-sm font-semibold tracking-tight text-neutral-900 dark:text-neutral-100">{{ name }}</h1>
          <p v-if="description" class="truncate text-xs text-neutral-500 dark:text-neutral-400">{{ description }}</p>
        </div>
      </div>

      <div class="flex shrink-0 items-center gap-2 sm:gap-3">
        <!-- Connection dot (colour = health, pulse only when live) + last updated. -->
        <div class="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
          <span class="relative flex h-2 w-2">
            <span v-if="connection === 'live'" class="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75" :class="connectionUi.ping"></span>
            <span class="relative inline-flex h-2 w-2 rounded-full" :class="connectionUi.dot"></span>
          </span>
          <span class="hidden sm:inline">{{ connectionUi.label }}</span>
          <span v-if="updatedLabel" class="hidden tabular-nums sm:inline">· {{ updatedLabel }}</span>
        </div>

        <!-- Viewer controls. Read-only data, so just refresh / theme / fullscreen. -->
        <div class="flex items-center gap-0.5 border-l border-neutral-200 pl-2 sm:pl-3 dark:border-neutral-800">
          <button
            type="button"
            class="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            aria-label="Refresh now"
            title="Refresh now"
            @click="refreshNow"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4" :class="{ 'animate-spin': refreshing }">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 4v5h-5" />
            </svg>
          </button>
          <button
            type="button"
            class="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            :aria-label="theme.resolved === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'"
            :title="theme.resolved === 'dark' ? 'Light theme' : 'Dark theme'"
            @click="theme.toggle()"
          >
            <svg v-if="theme.resolved === 'dark'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
              <circle cx="12" cy="12" r="4" />
              <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
              <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9z" />
            </svg>
          </button>
          <button
            type="button"
            class="rounded-md p-1.5 text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-800 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            :aria-label="isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'"
            :title="isFullscreen ? 'Exit fullscreen' : 'Fullscreen'"
            @click="toggleFullscreen"
          >
            <svg v-if="isFullscreen" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
              <path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M16 21v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
              <path d="M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M16 21h3a2 2 0 0 0 2-2v-3M8 21H5a2 2 0 0 1-2-2v-3" />
            </svg>
          </button>
        </div>
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

    <!-- Empty dashboard: a shared board with no widgets, shown instead of a blank grid. -->
    <div v-if="isEmpty && !isEmbed" class="flex flex-1 items-center justify-center p-6">
      <div class="max-w-xs text-center">
        <div class="mx-auto grid h-12 w-12 place-items-center rounded-full bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6">
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
            <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
            <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
            <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
          </svg>
        </div>
        <h1 class="mt-4 text-base font-semibold text-neutral-900 dark:text-neutral-100">Nothing to show yet</h1>
        <p class="mt-1.5 text-sm leading-relaxed text-neutral-500 dark:text-neutral-400">
          This dashboard doesn’t have any widgets yet. Check back once it’s been set up.
        </p>
      </div>
    </div>

    <!-- Grid. v-show (not v-if) so the container ref exists before we mount into it. -->
    <div
      v-show="status === 'ready' && !isEmpty"
      ref="container"
      :class="['flex-1 overflow-auto', onlyItem ? 'p-0' : isEmbed ? 'p-3' : 'p-6']"
    ></div>
  </main>
</template>
