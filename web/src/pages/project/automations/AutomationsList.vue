<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore } from '../../../stores/project';
import Icon from '../../../components/Icon.vue';
import AutomationCard from './AutomationCard.vue';
import { RECIPES } from './automation-recipes';

const project = useProjectStore();
const router = useRouter();

const variableLabel = (key: string): string => {
  const v = project.variables.find((x) => x.key === key);
  return v?.key || key || '—';
};
const integrationLabel = (id: string): string => {
  const i = project.integrations.find((x) => x.id === id);
  return i?.name ?? 'an integration';
};

const hasAny = computed(() => project.automations.length > 0);

function newAutomation() {
  router.push({ name: 'automation-editor' });
}
function startRecipe(id: string) {
  router.push({ name: 'automation-editor', query: { recipe: id } });
}
</script>

<template>
  <div>
    <div v-if="hasAny" class="mb-4 flex items-center justify-between">
      <p class="text-xs text-neutral-500 dark:text-neutral-400">
        {{ project.automations.length }} automation{{ project.automations.length === 1 ? '' : 's' }}
      </p>
      <button
        type="button"
        class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700"
        @click="newAutomation"
      >New automation</button>
    </div>

    <!-- List -->
    <div v-if="hasAny" class="divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      <AutomationCard
        v-for="a in project.automations"
        :key="a.id"
        :automation="a"
        :variable-label="variableLabel"
        :integration-label="integrationLabel"
      />
    </div>

    <!-- Empty: quick-start with recipes -->
    <div v-else>
      <div class="rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center dark:border-neutral-700 dark:bg-neutral-900">
        <h2 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">No automations yet</h2>
        <p class="mx-auto mt-1 max-w-md text-xs text-neutral-500 dark:text-neutral-400">
          Start from a template below, or build one from scratch.
        </p>
        <button
          type="button"
          class="mt-4 rounded-md bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-700"
          @click="newAutomation"
        >New automation</button>
      </div>

      <div class="mt-6">
        <h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Start from a template</h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <button
            v-for="r in RECIPES"
            :key="r.id"
            type="button"
            class="group flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:border-accent-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-accent-700"
            @click="startRecipe(r.id)"
          >
            <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
              <Icon :path="r.icon" class="h-5 w-5" />
            </div>
            <div class="min-w-0">
              <div class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{{ r.title }}</div>
              <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ r.description }}</div>
            </div>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
