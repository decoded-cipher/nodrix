<script setup lang="ts">
import { computed, provide } from 'vue';
import { manifestFor as specFor, type WidgetField } from '@nodrix/widgets-shared';
import { useProjectStore } from '../stores/project';
import ConfigField from './ConfigField.vue';
import type { WidgetInstance } from '../types';

const props = defineProps<{ item: WidgetInstance | null }>();
const emit = defineEmits<{
  update: [WidgetInstance];
  remove: [string];
  duplicate: [string];
  close: [];
}>();

const project = useProjectStore();
const spec = computed(() => (props.item ? specFor(props.item.type) : null));

const variableOptions = computed(() =>
  project.variables.map((v) => ({ value: v.key, label: v.key, hint: v.unit ?? undefined }))
);
provide('variableOptions', variableOptions);

function rootVisible(f: WidgetField): boolean {
  return !f.showWhen || props.item?.props[f.showWhen.key] === f.showWhen.equals;
}

// Selecting a variable prefills an empty `unit` field from the variable's unit.
function onRootChange(key: string, value: unknown) {
  if (!props.item) return;
  const patch: Record<string, unknown> = { [key]: value };
  const field = spec.value?.fields?.find((f) => f.key === key);
  if (field?.type === 'variable' && spec.value?.fields?.some((f) => f.key === 'unit')) {
    const unit = project.variables.find((v) => v.key === value)?.unit;
    if (unit && !props.item.props['unit']) patch['unit'] = unit;
  }
  emit('update', { ...props.item, props: { ...props.item.props, ...patch } });
}
</script>

<template>
  <aside
    v-if="item"
    class="pointer-events-auto absolute right-4 top-4 bottom-4 z-30 flex w-[calc(100%-2rem)] max-w-[20rem] flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
  >
    <div class="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <div class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Widget config
      </div>
      <div class="flex items-center gap-1">
        <button
          type="button"
          aria-label="Duplicate"
          title="Duplicate widget"
          class="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          @click="emit('duplicate', item.id)"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V4a2 2 0 0 1 2-2h10"/></svg>
        </button>
        <button
          type="button"
          aria-label="Delete"
          title="Delete widget"
          class="rounded-md p-1.5 text-neutral-500 hover:bg-red-50 hover:text-red-600 dark:text-neutral-400 dark:hover:bg-red-950/40 dark:hover:text-red-400"
          @click="emit('remove', item.id)"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
        </button>
        <button
          type="button"
          aria-label="Cancel"
          title="Close panel"
          class="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          @click="emit('close')"
        >
          <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
        </button>
      </div>
    </div>

    <div class="flex-1 space-y-4 overflow-y-auto p-4 text-sm">
      <div class="rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
        {{ spec?.label }} · <span class="font-mono">{{ item.id }}</span>
      </div>

      <template v-for="(f, i) in spec?.fields ?? []" :key="f.key ?? i">
        <ConfigField v-if="rootVisible(f)" :field="f" :model="item.props" @change="onRootChange" />
      </template>
    </div>
  </aside>
</template>
