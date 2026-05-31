<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useProjectStore } from '../../../stores/project';

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
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
    <header class="mb-5">
      <h1 class="text-xl font-semibold tracking-tight">Automations</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Run actions when something happens — and the integrations those actions reach out to.
      </p>
    </header>

    <!-- Tabs -->
    <div class="mb-6 border-b border-neutral-200 dark:border-neutral-800">
      <nav class="-mb-px flex gap-6 text-sm">
        <RouterLink
          v-for="t in tabs"
          :key="t.name"
          :to="t.to"
          class="border-b-2 px-1 pb-2.5 font-medium transition"
          :class="activeName === t.name
            ? 'border-accent-600 text-accent-700 dark:text-accent-400'
            : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'"
        >
          {{ t.label }}
          <span class="ml-1.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{{ t.count }}</span>
        </RouterLink>
      </nav>
    </div>

    <RouterView />
  </div>
</template>
