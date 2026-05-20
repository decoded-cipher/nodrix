<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import { useUiStore } from '../stores/ui';
import { useProjectStore } from '../stores/project';
import { useThemeStore } from '../stores/theme';

const route = useRoute();
const ui = useUiStore();
const project = useProjectStore();
const theme = useThemeStore();

const themeTitle = computed(() => {
  if (theme.mode === 'system') return `Theme: system (${theme.resolved}). Click to switch to light.`;
  if (theme.mode === 'light') return 'Theme: light. Click to switch to dark.';
  return 'Theme: dark. Click to switch to system.';
});

// Pages can teleport context-specific actions into #topbar-actions; when they
// do, swap out the default GitHub link rather than stacking both.
const hasPageActions = computed(() => route.path.endsWith('/edit'));

type Crumb = { label: string; to?: string };

const crumbs = computed<Crumb[]>(() => {
  const path = route.path;
  const out: Crumb[] = [];

  if (path === '/') return [{ label: 'Home' }];
  if (path.startsWith('/projects')) return [{ label: 'Projects' }];
  if (path.startsWith('/users')) return [{ label: 'Users' }];
  if (path.startsWith('/tokens')) return [{ label: 'API tokens' }];
  if (path.startsWith('/settings')) return [{ label: 'Settings' }];

  const projId = route.params['proj'] as string | undefined;
  if (projId) {
    const proj = ui.currentProject;
    out.push({ label: proj?.name ?? 'Project', to: `/p/${projId}/variables` });

    if (path.includes('/dashboards') || /\/d\//.test(path)) {
      out.push({ label: 'Dashboards', to: `/p/${projId}/dashboards` });
      const dash = route.params['dash'] as string | undefined;
      if (dash) {
        const meta = project.dashboards.find((d) => d.id === dash);
        const label = meta?.name ?? dash.slice(0, 8);
        const edit = path.endsWith('/edit');
        out.push({ label, to: edit ? `/p/${projId}/d/${dash}` : undefined });
        if (edit) out.push({ label: 'Edit' });
      }
    } else if (path.includes('/variables')) {
      out.push({ label: 'Variables' });
    } else if (path.includes('/automations')) {
      out.push({ label: 'Automations' });
    } else if (path.includes('/integrations')) {
      out.push({ label: 'Integrations' });
    } else if (path.includes('/settings')) {
      out.push({ label: 'Settings' });
    }
  }
  return out;
});
</script>

<template>
  <header class="flex h-14 items-center justify-between border-b border-neutral-200 bg-white px-5 dark:border-neutral-800 dark:bg-neutral-900">
    <nav class="flex items-center gap-1.5 text-sm text-neutral-500 dark:text-neutral-400">
      <template v-for="(c, i) in crumbs" :key="i">
        <RouterLink
          v-if="c.to && i !== crumbs.length - 1"
          :to="c.to"
          class="hover:text-neutral-900 dark:hover:text-neutral-100"
        >{{ c.label }}</RouterLink>
        <span
          v-else
          class="font-medium text-neutral-900 dark:text-neutral-100"
        >{{ c.label }}</span>
        <svg
          v-if="i < crumbs.length - 1"
          xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
          stroke-width="2" stroke="currentColor" class="h-3.5 w-3.5 text-neutral-300 dark:text-neutral-600"
        >
          <path stroke-linecap="round" stroke-linejoin="round" d="m9 5 7 7-7 7" />
        </svg>
      </template>
    </nav>

    <div class="flex items-center gap-2">
      <div id="topbar-actions" class="flex items-center gap-2"></div>
      <button
        v-if="!hasPageActions"
        type="button"
        class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 active:scale-95 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        :title="themeTitle"
        :aria-label="themeTitle"
        @click="theme.cycle()"
      >
        <!-- Sun (light) -->
        <svg
          v-if="theme.mode === 'light'"
          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
          class="h-4 w-4"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
        </svg>
        <!-- Moon (dark) -->
        <svg
          v-else-if="theme.mode === 'dark'"
          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
          class="h-4 w-4"
        >
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
        <!-- Monitor (system) -->
        <svg
          v-else
          xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"
          class="h-4 w-4"
        >
          <rect x="3" y="4" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16v4" />
        </svg>
      </button>
      <a
        v-if="!hasPageActions"
        href="https://github.com/decoded-cipher/nodrix"
        target="_blank"
        rel="noreferrer"
        class="inline-flex h-9 w-9 items-center justify-center rounded-md border border-neutral-200 bg-white text-neutral-600 shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 active:scale-95 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:border-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
        title="Docs &amp; GitHub"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4">
          <path fill-rule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.531 1.032 1.531 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.339-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0 1 12 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.748-1.026 2.748-1.026.546 1.378.203 2.397.1 2.65.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.31.678.92.678 1.855 0 1.338-.012 2.418-.012 2.747 0 .268.18.58.688.481A10.02 10.02 0 0 0 22 12.017C22 6.484 17.522 2 12 2Z" clip-rule="evenodd"/>
        </svg>
      </a>
    </div>
  </header>
</template>
