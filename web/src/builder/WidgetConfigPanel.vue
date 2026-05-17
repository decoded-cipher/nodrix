<script setup lang="ts">
import { computed } from 'vue';
import { specFor } from './widget-catalog';
import { useProjectStore } from '../stores/project';
import type { WidgetInstance } from '../types';

const props = defineProps<{ item: WidgetInstance | null }>();
const emit = defineEmits<{
  update: [WidgetInstance];
  remove: [string];
}>();

const project = useProjectStore();
const spec = computed(() => (props.item ? specFor(props.item.type) : null));

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
  <aside class="w-72 shrink-0 border-l border-neutral-200 bg-white overflow-y-auto">
    <div class="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
      <div class="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Widget config
      </div>
      <button
        v-if="item"
        type="button"
        class="rounded-md border border-red-300 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
        @click="emit('remove', item.id)"
      >Remove</button>
    </div>

    <div v-if="!item" class="p-6 text-sm text-neutral-500">
      Select a widget to configure it.
    </div>

    <div v-else class="space-y-4 p-4 text-sm">
      <div class="rounded bg-neutral-50 px-3 py-2 text-xs text-neutral-500">
        {{ spec?.label }} · <span class="font-mono">{{ item.id }}</span>
      </div>

      <template v-for="f in spec?.fields ?? []" :key="f.key">
        <label v-if="f.type === 'string'" class="block">
          <span class="block text-xs font-medium text-neutral-600">{{ f.label }}</span>
          <input
            :value="item.props[f.key] ?? ''"
            type="text"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            @input="setProp(f.key, ($event.target as HTMLInputElement).value)"
          />
        </label>

        <label v-else-if="f.type === 'number'" class="block">
          <span class="block text-xs font-medium text-neutral-600">{{ f.label }}</span>
          <input
            :value="item.props[f.key] ?? 0"
            type="number"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            @input="setProp(f.key, Number(($event.target as HTMLInputElement).value))"
          />
        </label>

        <label v-else-if="f.type === 'device'" class="block">
          <span class="block text-xs font-medium text-neutral-600">{{ f.label }}</span>
          <select
            :value="item.props[f.key] ?? ''"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            @change="setProp(f.key, ($event.target as HTMLSelectElement).value)"
          >
            <option value="">Select a device</option>
            <option v-for="d in project.devices" :key="d.id" :value="d.id">{{ d.name }} ({{ d.id }})</option>
          </select>
        </label>

        <label v-else-if="f.type === 'select'" class="block">
          <span class="block text-xs font-medium text-neutral-600">{{ f.label }}</span>
          <select
            :value="item.props[f.key]"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            @change="setProp(f.key, ($event.target as HTMLSelectElement).value)"
          >
            <option v-for="o in f.options ?? []" :key="o" :value="o">{{ o }}</option>
          </select>
        </label>

        <div v-else-if="f.type === 'series'" class="space-y-3">
          <div class="text-xs font-medium text-neutral-600">{{ f.label }}</div>
          <div
            v-for="(s, idx) in (item.props.series as Array<Record<string, unknown>>) ?? []"
            :key="idx"
            class="space-y-2 rounded-md border border-neutral-200 p-3"
          >
            <select
              :value="s['device'] ?? ''"
              class="w-full rounded border border-neutral-300 px-2 py-1.5 text-xs"
              @change="updateSeries(idx, 'device', ($event.target as HTMLSelectElement).value)"
            >
              <option value="">device</option>
              <option v-for="d in project.devices" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
            <input
              :value="s['metric'] ?? ''"
              type="text"
              placeholder="metric"
              class="w-full rounded border border-neutral-300 px-2 py-1.5 text-xs"
              @input="updateSeries(idx, 'metric', ($event.target as HTMLInputElement).value)"
            />
            <input
              :value="s['label'] ?? ''"
              type="text"
              placeholder="label (optional)"
              class="w-full rounded border border-neutral-300 px-2 py-1.5 text-xs"
              @input="updateSeries(idx, 'label', ($event.target as HTMLInputElement).value)"
            />
            <button
              type="button"
              class="w-full rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50"
              @click="removeSeries(idx)"
            >Remove series</button>
          </div>
          <button
            type="button"
            class="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
            @click="addSeries"
          >+ Add series</button>
        </div>
      </template>
    </div>
  </aside>
</template>
