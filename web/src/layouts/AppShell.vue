<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useProjectStore } from '../stores/project';
import { useUiStore } from '../stores/ui';
import Sidebar from './Sidebar.vue';
import Topbar from './Topbar.vue';

const session = useSessionStore();
const project = useProjectStore();
const ui = useUiStore();
const route = useRoute();
const router = useRouter();

const routeProjId = computed(() => (route.params['proj'] as string | undefined) ?? null);
const isDashboardEditor = computed(() => route.name === 'dashboard-edit');

onMounted(async () => {
  if (!session.user) await session.load();
  ui.ensureValidProject();
  // Sync project store with route or stored selection.
  const target = routeProjId.value ?? ui.currentProject?.id ?? null;
  if (target) {
    if (routeProjId.value) ui.setCurrentProject(routeProjId.value);
    await project.switchTo(target);
  }
});

// Redirect to login if unauthenticated. (The api.ts onUnauthorized hook
// catches most 401s, but watching session.error covers the initial load case.)
watch(
  () => session.error,
  (err) => {
    if (err && err.status === 401) router.replace('/login');
  }
);

// Keep UI store + project store in sync when the URL's :proj changes.
watch(routeProjId, async (id) => {
  if (!id) return;
  ui.setCurrentProject(id);
  await project.switchTo(id);
});

// After session loads, make sure the stored project still exists.
watch(
  () => session.projects.length,
  () => ui.ensureValidProject()
);

// Collapse the sidebar while the dashboard editor is open, restore on exit.
watch(
  isDashboardEditor,
  (editing) => {
    if (editing) ui.autoCollapseForEditor();
    else ui.restoreSidebarFromEditor();
  },
  { immediate: true }
);
</script>

<template>
  <div v-if="session.loading && !session.user" class="grid h-full place-items-center text-sm text-neutral-500">
    Loading...
  </div>
  <div v-else-if="session.error && session.error.status !== 401" class="grid h-full place-items-center">
    <div class="max-w-md text-center">
      <h2 class="text-lg font-semibold">Could not load session</h2>
      <p class="mt-2 text-sm text-neutral-600">
        Status {{ session.error.status }}<span v-if="session.error.reason">: {{ session.error.reason }}</span>
      </p>
    </div>
  </div>
  <div v-else class="flex h-full">
    <Sidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <Topbar />
      <main class="flex-1 overflow-auto bg-neutral-50">
        <RouterView />
      </main>
    </div>
  </div>
</template>
