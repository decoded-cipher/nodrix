<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectStore } from '../../../stores/project';
import Icon from '../../../components/Icon.vue';
import ConnectionCard from './ConnectionCard.vue';
import ConnectionForm from './ConnectionForm.vue';
import { EXECUTABLE_CONNECTIONS, COMING_SOON_CONNECTIONS } from '@nodrix/integrations-shared';
import type { Automation, Integration, IntegrationKind } from '../../../types';

const project = useProjectStore();

const formKind = ref<IntegrationKind | null>(null);
const editing = ref<Integration | null>(null);

// integration id -> automations that call it (each automation counted once).
const usedByMap = computed(() => {
  const map: Record<string, Automation[]> = {};
  for (const a of project.automations) {
    const actions = Array.isArray(a.actions) ? a.actions : [];
    const seen = new Set<string>();
    for (const raw of actions) {
      const act = raw as { type?: string; integration_id?: string };
      if (act.type === 'call_integration' && act.integration_id && !seen.has(act.integration_id)) {
        seen.add(act.integration_id);
        (map[act.integration_id] ??= []).push(a);
      }
    }
  }
  return map;
});

function usedBy(id: string): Automation[] {
  return usedByMap.value[id] ?? [];
}

function openCreate(kind: IntegrationKind) {
  editing.value = null;
  formKind.value = kind;
}
function openEdit(i: Integration) {
  editing.value = i;
  formKind.value = i.kind;
}
function closeForm() {
  formKind.value = null;
  editing.value = null;
}
</script>

<template>
  <div>
    <!-- Create / edit form -->
    <ConnectionForm
      v-if="formKind"
      :key="editing?.id ?? formKind"
      class="mb-6"
      :kind="formKind"
      :integration="editing"
      @saved="closeForm"
      @cancel="closeForm"
    />

    <!-- Existing integrations -->
    <div v-if="project.integrations.length" class="mb-8 divide-y divide-neutral-200 rounded-xl border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      <ConnectionCard
        v-for="i in project.integrations"
        :key="i.id"
        :integration="i"
        :used-by="usedBy(i.id)"
        @edit="openEdit"
      />
    </div>
    <div v-else class="mb-8 rounded-xl border border-dashed border-neutral-300 bg-white p-8 text-center text-xs text-neutral-500 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-400">
      No integrations yet. Add one below, then call it from an automation.
    </div>

    <!-- Catalog -->
    <div>
      <h3 class="mb-3 text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Add an integration</h3>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <button
          v-for="c in EXECUTABLE_CONNECTIONS"
          :key="c.kind"
          type="button"
          class="flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:border-accent-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-accent-700"
          @click="openCreate(c.kind)"
        >
          <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
            <Icon :path="c.icon" class="h-5 w-5" />
          </div>
          <div class="min-w-0">
            <div class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{{ c.label }}</div>
            <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{{ c.description }}</div>
          </div>
        </button>
      </div>

      <!-- Coming soon -->
      <template v-if="COMING_SOON_CONNECTIONS.length">
        <h3 class="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-neutral-400 dark:text-neutral-500">Coming soon</h3>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button
            v-for="c in COMING_SOON_CONNECTIONS"
            :key="c.kind"
            type="button"
            class="flex items-start gap-3 rounded-xl border border-dashed border-neutral-200 bg-neutral-50 p-4 text-left transition hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900/40 dark:hover:border-neutral-700"
            :title="`${c.label} can be configured now and will run once its connector lands`"
            @click="openCreate(c.kind)"
          >
            <div class="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-neutral-200 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              <Icon :path="c.icon" class="h-5 w-5" />
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="text-sm font-semibold text-neutral-700 dark:text-neutral-300">{{ c.label }}</span>
              </div>
              <div class="mt-0.5 text-xs text-neutral-400 dark:text-neutral-500">{{ c.description }}</div>
            </div>
          </button>
        </div>
      </template>
    </div>
  </div>
</template>
