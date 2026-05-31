<script setup lang="ts">
import { computed, onMounted } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useProjectStore } from '../../../stores/project';

const project = useProjectStore();
const route = useRoute();

// Load both halves up front so each tab's count badge is correct on arrival.
onMounted(() => {
  void Promise.all([project.loadVariables(), project.loadProjectTokens()]);
});

const proj = computed(() => project.currentProjectId ?? '');

const tabs = computed(() => [
  { name: 'variables', label: 'Variables', to: `/p/${proj.value}/variables`, count: project.variables.length },
  { name: 'tokens', label: 'Connection tokens', to: `/p/${proj.value}/variables/tokens`, count: project.projectTokens.length },
]);

const activeName = computed(() => (route.name === 'variable-tokens' ? 'tokens' : 'variables'));
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
    <header class="mb-5">
      <h1 class="text-xl font-semibold tracking-tight">Variables</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        The data points your hardware posts to — and the tokens it uses to connect.
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
