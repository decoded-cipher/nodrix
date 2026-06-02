<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { useSessionStore } from '../stores/session';
import { useProjectStore } from '../stores/project';
import { useUiStore } from '../stores/ui';

const session = useSessionStore();
const project = useProjectStore();
const ui = useUiStore();

onMounted(async () => {
  if (!session.user) await session.load();
  ui.ensureValidProject();
  if (ui.currentProject) await project.switchTo(ui.currentProject.id);
});

const greeting = computed(() => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
});

const greetingName = computed(() => {
  const u = session.user;
  if (!u) return null;
  if (u.first_name && u.first_name.trim()) return u.first_name.trim();
  return 'there';
});

const stats = computed(() => [
  {
    label: 'Projects',
    value: session.projects.length,
    href: '/projects',
  },
  {
    label: 'Variables',
    value: project.variables.length,
    href: ui.currentProject ? `/p/${ui.currentProject.id}/variables` : '/projects',
  },
  {
    label: 'Dashboards',
    value: project.dashboards.length,
    href: ui.currentProject ? `/p/${ui.currentProject.id}/dashboards` : '/projects',
  },
  {
    label: 'Active now',
    value: project.variables.filter((v) => {
      if (!v.last_seen) return false;
      return Date.now() / 1000 - v.last_seen < 60;
    }).length,
    href: ui.currentProject ? `/p/${ui.currentProject.id}/variables` : '/projects',
  },
]);

const projectQuickLinks = computed(() => {
  if (!ui.currentProject) return [];
  const id = ui.currentProject.id;
  return [
    { label: 'New dashboard', desc: 'Drag widgets to visualize variable data', to: `/p/${id}/dashboards`, color: 'orange' },
    { label: 'Add variable', desc: 'Declare a data point or get a connection token', to: `/p/${id}/variables`, color: 'sky' },
    { label: 'Create automation', desc: 'Trigger actions on schedule, state, or event', to: `/p/${id}/automations`, color: 'emerald' },
    { label: 'Add integration', desc: 'Email, SMS, chat, HTTP — reusable connectors', to: `/p/${id}/integrations`, color: 'violet' },
  ];
});

const colorClasses: Record<string, string> = {
  orange: 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300',
  sky: 'bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300',
  emerald: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  violet: 'bg-violet-50 text-violet-700 dark:bg-violet-900/30 dark:text-violet-300',
};
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
    <header class="mb-8">
      <h1 class="text-2xl font-semibold tracking-tight">
        {{ greeting }}{{ greetingName ? `, ${greetingName}` : '' }}
      </h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Here's what's happening in
        <span class="font-medium text-neutral-900 dark:text-neutral-100">{{ ui.currentProject?.name ?? 'your workspace' }}</span>.
      </p>
    </header>

    <!-- Stats -->
    <section class="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
      <RouterLink
        v-for="s in stats"
        :key="s.label"
        :to="s.href"
        class="rounded-lg border border-neutral-200 bg-white p-4 hover:border-accent-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-accent-700"
      >
        <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{{ s.label }}</div>
        <div class="mt-1 text-2xl font-semibold tracking-tight">{{ s.value }}</div>
      </RouterLink>
    </section>

    <!-- Quick actions -->
    <section v-if="projectQuickLinks.length" class="mb-8">
      <h2 class="mb-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">Quick actions</h2>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <RouterLink
          v-for="q in projectQuickLinks"
          :key="q.label"
          :to="q.to"
          class="rounded-lg border border-neutral-200 bg-white p-4 transition hover:border-accent-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-accent-700"
        >
          <div
            class="grid h-9 w-9 place-items-center rounded-md"
            :class="colorClasses[q.color]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
              <path d="M12 4.5v15m7.5-7.5h-15" />
            </svg>
          </div>
          <div class="mt-3 text-sm font-medium">{{ q.label }}</div>
          <div class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">{{ q.desc }}</div>
        </RouterLink>
      </div>
    </section>

    <!-- Empty state for no projects -->
    <section v-if="session.projects.length === 0" class="rounded-lg border border-dashed border-neutral-300 bg-white p-10 text-center dark:border-neutral-700 dark:bg-neutral-900">
      <h3 class="text-base font-semibold">Create your first project</h3>
      <p class="mx-auto mt-2 max-w-md text-sm text-neutral-600 dark:text-neutral-400">
        Projects are isolated workspaces. Each one holds its own devices, dashboards, and automations.
      </p>
      <RouterLink
        to="/projects"
        class="mt-4 inline-block rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
      >Go to Projects</RouterLink>
    </section>

    <!-- Recent dashboards -->
    <section v-else-if="project.dashboards.length" class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <h2 class="text-sm font-semibold">Recent dashboards</h2>
        <RouterLink
          v-if="ui.currentProject"
          :to="`/p/${ui.currentProject.id}/dashboards`"
          class="text-xs text-accent-700 hover:underline dark:text-accent-400"
        >View all →</RouterLink>
      </div>
      <ul class="divide-y divide-neutral-100 dark:divide-neutral-800">
        <li
          v-for="d in project.dashboards.slice(0, 5)"
          :key="d.id"
          class="flex items-center justify-between px-4 py-3"
        >
          <RouterLink
            :to="ui.currentProject ? `/p/${ui.currentProject.id}/d/${d.id}` : '/'"
            class="text-sm font-medium hover:underline"
          >{{ d.name }}</RouterLink>
          <span class="font-mono text-[11px] text-neutral-400 dark:text-neutral-500">{{ d.id.slice(0, 8) }}</span>
        </li>
      </ul>
    </section>
  </div>
</template>
