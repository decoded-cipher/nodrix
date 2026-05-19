<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { RouterView, useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useProjectStore } from '../stores/project';
import { useUiStore } from '../stores/ui';
import { api } from '../api';
import Sidebar from './Sidebar.vue';
import Topbar from './Topbar.vue';
import Spinner from '../components/Spinner.vue';

// 24h grace window after "Skip for now" — the banner re-appears past it.
const DISMISS_GRACE_SECONDS = 24 * 60 * 60;
const showOnboardingBanner = ref(false);

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
  // Owner-only: nudge through update-config onboarding. Auto-redirects on
  // first hit (no prior dismissal); surfaces a banner thereafter until the
  // 24h grace window expires, at which point we redirect again. Failures
  // from the endpoint are silently swallowed — onboarding is non-essential.
  if (session.user?.role === 'owner') {
    try {
      const status = await api.get<{ configured: boolean; dismissed_at: number | null }>(
        '/v1/admin/update'
      );
      if (!status.configured) {
        const now = Math.floor(Date.now() / 1000);
        const stale = !status.dismissed_at || now - status.dismissed_at > DISMISS_GRACE_SECONDS;
        if (stale) {
          router.replace('/onboarding');
        } else {
          showOnboardingBanner.value = true;
        }
      }
    } catch { /* non-fatal */ }
  }
});

async function dismissBanner() {
  showOnboardingBanner.value = false;
  try { await api.post<void>('/v1/admin/update/dismiss'); } catch { /* best-effort */ }
}

function goToOnboarding() {
  router.push('/onboarding');
}

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
  <div v-if="session.loading && !session.user" class="grid h-full place-items-center">
    <Spinner size="lg" />
  </div>
  <div v-else-if="session.error && session.error.status !== 401" class="grid h-full place-items-center">
    <div class="max-w-md text-center">
      <h2 class="text-lg font-semibold">Could not load session</h2>
      <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Status {{ session.error.status }}<span v-if="session.error.reason">: {{ session.error.reason }}</span>
      </p>
    </div>
  </div>
  <div v-else class="flex h-full">
    <Sidebar />
    <div class="flex min-w-0 flex-1 flex-col">
      <!-- Onboarding nudge: shown to owners who skipped the wizard. The
           banner re-asks once per 24h via the AppShell-level dismiss logic. -->
      <div
        v-if="showOnboardingBanner"
        class="flex items-center justify-between gap-3 border-b border-orange-200 bg-orange-50 px-5 py-2 text-xs dark:border-orange-900/60 dark:bg-orange-900/20"
      >
        <span class="text-orange-900 dark:text-orange-300">
          <span class="font-semibold">Finish setup:</span>
          enable one-click updates so you can install new versions from Settings.
        </span>
        <div class="flex items-center gap-2">
          <button
            type="button"
            class="rounded-md bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-700"
            @click="goToOnboarding"
          >Complete setup</button>
          <button
            type="button"
            class="rounded-md p-1 text-orange-700 hover:bg-orange-100 dark:text-orange-300 dark:hover:bg-orange-900/40"
            title="Dismiss for 24 hours"
            aria-label="Dismiss"
            @click="dismissBanner"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-3.5 w-3.5">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
      <Topbar />
      <main class="flex-1 overflow-auto bg-neutral-50 dark:bg-neutral-950">
        <RouterView />
      </main>
    </div>
  </div>
</template>
