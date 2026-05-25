<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useProjectStore } from '../../stores/project';
import { useSessionStore } from '../../stores/session';
import { DashboardWs } from '../../ws';
import { useDashboardGrid } from '../../composables/useDashboardGrid';
import { useIsPhone } from '../../composables/useViewport';
import { effectiveMobileLayout } from '../../builder/mobile-layout';
import ShareDialog from '../../components/ShareDialog.vue';
import type { Dashboard, Layout, SnapshotMsg, WsServerMsg } from '../../types';

const route = useRoute();
const project = useProjectStore();
const session = useSessionStore();

// Anyone with access to the project has full control. If the project is in the
// caller's project list they can edit/control; otherwise (e.g. a public share
// view with no membership) it's read-only.
const canEdit = computed(() => {
  const projId = route.params['proj'] as string;
  return session.projects.some((p) => p.id === projId);
});

const dashboard = ref<Dashboard | null>(null);
const error = ref<string | null>(null);
const gridContainer = ref<HTMLElement | null>(null);
const grid = useDashboardGrid();
const sharing = ref(false);
let ws: DashboardWs | null = null;

// Below 768px render the phone layout (override if set, else auto-derived).
const isPhone = useIsPhone();
const renderLayout = computed<Layout>(() => {
  const d = dashboard.value;
  if (!d) return { grid: { columns: 24 }, items: [] };
  return isPhone.value ? effectiveMobileLayout(d.layout) : d.layout;
});
// Re-applied after a breakpoint remount so the new grid shows live data at once.
let lastSnapshot: SnapshotMsg | null = null;

onMounted(async () => {
  const projId = route.params['proj'] as string;
  const dashId = route.params['dash'] as string;
  try {
    await project.switchTo(projId);
    dashboard.value = await project.fetchDashboard(dashId);
    grid.mount(gridContainer.value!, renderLayout.value);
  } catch {
    error.value = 'This dashboard could not be loaded. It may have been removed, or you may not have access to it.';
    return;
  }

  // Remount when the desktop<->phone breakpoint flips (or the layout changes).
  watch(renderLayout, (lay) => {
    if (!gridContainer.value) return;
    grid.mount(gridContainer.value, lay);
    if (lastSnapshot) grid.applySnapshot(lay, lastSnapshot.variables, lastSnapshot.series);
  });

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

function handleMessage(msg: WsServerMsg) {
  if (!dashboard.value) return;
  if (msg.type === 'snapshot') {
    lastSnapshot = msg;
    grid.applySnapshot(renderLayout.value, msg.variables, msg.series);
  } else if (msg.type === 'update') {
    grid.applyUpdate(msg);
  }
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

// Keep the local copy's share fields in sync after the dialog changes them, so
// reopening the dialog reflects the current state (this object came from a REST
// fetch, not the store list the dialog mutates).
function onShareChange(next: { visibility: 'private' | 'public'; share_token: string | null }) {
  if (!dashboard.value) return;
  dashboard.value.visibility = next.visibility;
  dashboard.value.share_token = next.share_token;
}
</script>

<template>
  <main class="flex h-full flex-col">
    <!-- Share + Edit live in the topbar (replacing theme + GitHub), like the
         editor's Done/Save — so the view has no sub-navbar of its own. -->
    <Teleport to="#topbar-actions" defer>
      <div v-if="dashboard && canEdit" class="flex items-center gap-2">
        <button
          type="button"
          class="inline-flex items-center gap-1.5 rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="sharing = true"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
            <circle cx="18" cy="5" r="2.5" />
            <circle cx="6" cy="12" r="2.5" />
            <circle cx="18" cy="19" r="2.5" />
            <path d="M8.2 10.7l7.6-4.4M8.2 13.3l7.6 4.4" />
          </svg>
          <span>Share</span>
          <span
            v-if="dashboard.visibility === 'public'"
            class="h-1.5 w-1.5 rounded-full bg-emerald-500"
            title="This dashboard is public"
          ></span>
        </button>
        <RouterLink
          :to="`/p/${project.currentProjectId}/d/${dashboard.id}/edit`"
          class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        >Edit</RouterLink>
      </div>
    </Teleport>
    <div v-if="error" class="p-6 text-sm text-red-600 dark:text-red-400">{{ error }}</div>
    <div ref="gridContainer" class="flex-1 overflow-auto p-6"></div>

    <ShareDialog
      v-if="sharing && dashboard"
      :dashboard="dashboard"
      @close="sharing = false"
      @change="onShareChange"
    />
  </main>
</template>
