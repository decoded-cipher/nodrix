<script setup lang="ts">
import { computed } from 'vue';
import { specFor } from './widget-catalog';
import { useProjectStore } from '../stores/project';
import Dropdown from '../components/Dropdown.vue';
import Toggle from '../components/Toggle.vue';
import type { WidgetInstance } from '../types';

const props = defineProps<{ item: WidgetInstance | null }>();
const emit = defineEmits<{
  update: [WidgetInstance];
  remove: [string];
  close: [];
}>();

const project = useProjectStore();
const spec = computed(() => (props.item ? specFor(props.item.type) : null));

const deviceOptions = computed(() =>
  project.devices.map((d) => ({ value: d.id, label: d.name, hint: d.id }))
);

function setProp(key: string, v: unknown) {
  if (!props.item) return;
  emit('update', { ...props.item, props: { ...props.item.props, [key]: v } });
}

function updateSeries(idx: number, key: string, v: unknown) {
  if (!props.item) return;
  const series = [...((props.item.props['series'] as Array<Record<string, unknown>>) ?? [])];
  series[idx] = { ...series[idx], [key]: v };
  setProp('series', series);
}

function addSeries() {
  if (!props.item) return;
  const series = [...((props.item.props['series'] as Array<Record<string, unknown>>) ?? [])];
  series.push({ device: '', metric: '', label: '' });
  setProp('series', series);
}

function removeSeries(idx: number) {
  if (!props.item) return;
  const series = [...((props.item.props['series'] as Array<Record<string, unknown>>) ?? [])];
  series.splice(idx, 1);
  setProp('series', series);
}
</script>

<template>
  <aside
    v-if="item"
    class="pointer-events-auto absolute right-4 top-4 bottom-4 z-30 flex w-80 flex-col rounded-lg border border-neutral-200 bg-white shadow-xl dark:border-neutral-800 dark:bg-neutral-900"
  >
    <div class="flex items-center justify-between border-b border-neutral-200 px-4 py-3 dark:border-neutral-800">
      <div class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Widget config
      </div>
      <div class="flex items-center gap-1.5">
        <button
          type="button"
          class="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          @click="emit('remove', item.id)"
        >Remove</button>
        <button
          type="button"
          aria-label="Close"
          class="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
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

      <template v-for="f in spec?.fields ?? []" :key="f.key">
        <label v-if="f.type === 'string'" class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ f.label }}</span>
          <input
            :value="item.props[f.key] ?? ''"
            type="text"
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            @input="setProp(f.key, ($event.target as HTMLInputElement).value)"
          />
        </label>

        <label v-else-if="f.type === 'number'" class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ f.label }}</span>
          <input
            :value="item.props[f.key] ?? 0"
            type="number"
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            @input="setProp(f.key, Number(($event.target as HTMLInputElement).value))"
          />
        </label>

        <div v-else-if="f.type === 'boolean'" class="flex items-center justify-between">
          <span class="text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ f.label }}</span>
          <Toggle
            :model-value="Boolean(item.props[f.key])"
            :label="f.label"
            @update:model-value="(v) => setProp(f.key, v)"
          />
        </div>

        <div v-else-if="f.type === 'device'" class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ f.label }}</span>
          <Dropdown
            class="mt-1"
            :model-value="(item.props[f.key] as string) ?? ''"
            :options="deviceOptions"
            placeholder="Select a device"
            @update:model-value="(v) => setProp(f.key, v)"
          />
        </div>

        <div v-else-if="f.type === 'select'" class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ f.label }}</span>
          <Dropdown
            class="mt-1"
            :model-value="(item.props[f.key] as string) ?? ''"
            :options="(f.options ?? []).map((o) => ({ value: o, label: o }))"
            @update:model-value="(v) => setProp(f.key, v)"
          />
        </div>

        <div v-else-if="f.type === 'series'" class="space-y-3">
          <div class="text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ f.label }}</div>
          <div
            v-for="(s, idx) in (item.props.series as Array<Record<string, unknown>>) ?? []"
            :key="idx"
            class="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <Dropdown
              :model-value="(s['device'] as string) ?? ''"
              :options="deviceOptions"
              placeholder="device"
              size="sm"
              @update:model-value="(v) => updateSeries(idx, 'device', v)"
            />
            <input
              :value="s['metric'] ?? ''"
              type="text"
              placeholder="metric"
              class="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              @input="updateSeries(idx, 'metric', ($event.target as HTMLInputElement).value)"
            />
            <input
              :value="s['label'] ?? ''"
              type="text"
              placeholder="label (optional)"
              class="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              @input="updateSeries(idx, 'label', ($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="w-full rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              @click="removeSeries(idx)"
            >Remove series</button>
          </div>
          <button
            type="button"
            class="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            @click="addSeries"
          >+ Add series</button>
        </div>
      </template>
    </div>
  </aside>
</template>
