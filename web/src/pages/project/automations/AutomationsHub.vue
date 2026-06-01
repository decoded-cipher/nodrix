<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useProjectStore } from '../../../stores/project';
import Icon from '../../../components/Icon.vue';

const project = useProjectStore();
const route = useRoute();

// Load everything both tabs need: automations + integrations + variables (for
// label resolution and the integrations "used by" cross-reference).
onMounted(() => {
  void Promise.all([
    project.loadAutomations(),
    project.loadIntegrations(),
    project.loadVariables(),
  ]);
});

const proj = computed(() => project.currentProjectId ?? '');

const tabs = computed(() => [
  { name: 'automations', label: 'Automations', to: `/p/${proj.value}/automations`, count: project.automations.length },
  { name: 'integrations', label: 'Integrations', to: `/p/${proj.value}/automations/integrations`, count: project.integrations.length },
]);

const activeName = computed(() => (route.name === 'integrations' ? 'integrations' : 'automations'));

const HUB_ICON = 'M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99';
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
    <header class="mb-6 flex items-start gap-3.5">
      <div class="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
        <Icon :path="HUB_ICON" class="h-5 w-5" />
      </div>
      <div class="min-w-0">
        <h1 class="text-xl font-semibold tracking-tight">Automations</h1>
        <p class="mt-0.5 text-sm text-neutral-600 dark:text-neutral-400">
          Run actions when something happens — and manage the integrations they reach out to.
        </p>
      </div>
    </header>

    <!-- Segmented tabs -->
    <div class="mb-6 inline-flex rounded-lg border border-neutral-200 bg-neutral-100/70 p-0.5 dark:border-neutral-800 dark:bg-neutral-900">
      <RouterLink
        v-for="t in tabs"
        :key="t.name"
        :to="t.to"
        class="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition"
        :class="activeName === t.name
          ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100'
          : 'text-neutral-500 hover:text-neutral-800 dark:text-neutral-400 dark:hover:text-neutral-200'"
      >
        {{ t.label }}
        <span
          class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
          :class="activeName === t.name
            ? 'bg-accent-100 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300'
            : 'bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'"
        >{{ t.count }}</span>
      </RouterLink>
    </div>

    <RouterView />
  </div>
</template>
