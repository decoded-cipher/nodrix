<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore } from '../../../stores/project';
import { toast } from '../../../lib/toast';
import Icon from '../../../components/Icon.vue';
import AutomationCard from './AutomationCard.vue';
import { RECIPES, recipeById } from './automation-recipes';
import { connSpec } from '@nodrix/integrations-shared';
import { buildLinearGraph } from '@nodrix/blocks-shared';
import type { Automation } from '../../../types';

const project = useProjectStore();
const router = useRouter();

const variableLabel = (key: string): string => {
  const v = project.variables.find((x) => x.key === key);
  return v?.key || key || '—';
};
const integration = (id: string) => {
  const i = project.integrations.find((x) => x.id === id);
  return i ? { name: i.name, icon: connSpec(i.kind).icon } : undefined;
};

const hasAny = computed(() => project.automations.length > 0);

function openEditor(id: string) {
  router.push({ name: 'automation-editor', params: { id } });
}

// ─── Create / edit-details modal (name + description live here, not the editor) ──
const mode = ref<'create' | 'edit' | null>(null);
const editingId = ref<string | null>(null);
const form = ref({ name: '', description: '' });
const busy = ref(false);

function openCreate() {
  mode.value = 'create';
  editingId.value = null;
  form.value = { name: '', description: '' };
}
function openEditDetails(a: Automation) {
  mode.value = 'edit';
  editingId.value = a.id;
  form.value = { name: a.name, description: a.description ?? '' };
}
function closeModal() { mode.value = null; }

async function submitModal() {
  const name = form.value.name.trim();
  if (!name) return;
  busy.value = true;
  try {
    if (mode.value === 'create') {
      const a = await project.createAutomation({ name, description: form.value.description.trim() || null, graph: { nodes: [], edges: [] } });
      mode.value = null;
      openEditor(a.id);
    } else if (editingId.value) {
      await project.updateAutomation(editingId.value, { name, description: form.value.description.trim() || null });
      mode.value = null;
    }
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}

// A recipe creates a named automation with a starter graph, then opens the editor.
async function startRecipe(id: string) {
  const r = recipeById(id);
  if (!r) return;
  busy.value = true;
  try {
    const a = await project.createAutomation({
      name: r.name,
      graph: buildLinearGraph(r.trigger_type, r.trigger_config ?? {}, r.actions ?? []),
    });
    openEditor(a.id);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div>
    <!-- Action row -->
    <div class="mb-4 flex items-center justify-between gap-3">
      <p class="text-sm text-neutral-500 dark:text-neutral-400">
        <template v-if="hasAny">{{ project.automations.length }} automation{{ project.automations.length === 1 ? '' : 's' }}</template>
        <template v-else>Trigger actions from device data, schedules, sun times, or events.</template>
      </p>
      <button
        type="button"
        class="shrink-0 rounded-md bg-accent-600 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-accent-700"
        @click="openCreate"
      >New automation</button>
    </div>

    <!-- List -->
    <div v-if="hasAny" class="space-y-3">
      <AutomationCard
        v-for="a in project.automations"
        :key="a.id"
        :automation="a"
        :variable-label="variableLabel"
        :integration="integration"
        @edit-details="openEditDetails"
      />
    </div>

    <!-- Empty: jump-start from a template -->
    <div v-else class="rounded-xl border border-dashed border-neutral-300 bg-white p-5 dark:border-neutral-700 dark:bg-neutral-900 sm:p-6">
      <h3 class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">Start from a template</h3>
      <p class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Pick a starting point and tweak it — or use “New automation” for a blank canvas.</p>
      <div class="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          v-for="r in RECIPES"
          :key="r.id"
          type="button"
          class="group flex items-start gap-3 rounded-xl border border-neutral-200 bg-white p-4 text-left transition hover:border-accent-400 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-950 dark:hover:border-accent-700"
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

    <!-- Create / edit-details modal -->
    <div
      v-if="mode"
      class="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4 dark:bg-black/70"
      @click.self="closeModal"
    >
      <div class="w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800">
        <header class="border-b border-neutral-100 px-5 py-3 text-sm font-semibold dark:border-neutral-800">
          {{ mode === 'create' ? 'New automation' : 'Edit automation' }}
        </header>
        <form class="space-y-3 px-5 py-4" @submit.prevent="submitModal">
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Name</span>
            <input
              v-model="form.name"
              type="text"
              required
              placeholder="e.g. Fan on when hot"
              class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Description (optional)</span>
            <textarea
              v-model="form.description"
              rows="2"
              class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>
          <div class="flex justify-end gap-2 pt-1">
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="closeModal"
            >Cancel</button>
            <button
              type="submit"
              :disabled="busy || !form.name.trim()"
              class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
            >{{ busy ? 'Saving…' : mode === 'create' ? 'Create & edit flow' : 'Save changes' }}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
