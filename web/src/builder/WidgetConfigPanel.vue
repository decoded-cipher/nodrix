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
  duplicate: [string];
  close: [];
}>();

const project = useProjectStore();
const spec = computed(() => (props.item ? specFor(props.item.type) : null));

const variableOptions = computed(() =>
  project.variables.map((v) => ({
    value: v.key,
    label: v.key,
    hint: v.unit ?? undefined,
  }))
);

function setProp(key: string, v: unknown) {
  if (!props.item) return;
  emit('update', { ...props.item, props: { ...props.item.props, [key]: v } });
}

// Selecting a variable also prefills the widget's `unit` from the variable's
// unit — but only when the widget has a unit field and the user hasn't set one,
// so we never clobber a manual override.
function selectVariable(key: string, varKey: string) {
  if (!props.item) return;
  const patch: Record<string, unknown> = { [key]: varKey };
  const hasUnitField = spec.value?.fields?.some((f) => f.key === 'unit');
  const unit = project.variables.find((v) => v.key === varKey)?.unit;
  if (hasUnitField && unit && !props.item.props['unit']) patch['unit'] = unit;
  emit('update', { ...props.item, props: { ...props.item.props, ...patch } });
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
  series.push({ variable: '', label: '' });
  setProp('series', series);
}

function removeSeries(idx: number) {
  if (!props.item) return;
  const series = [...((props.item.props['series'] as Array<Record<string, unknown>>) ?? [])];
  series.splice(idx, 1);
  setProp('series', series);
}

function updateMarker(idx: number, key: string, v: unknown) {
  if (!props.item) return;
  const markers = [...((props.item.props['markers'] as Array<Record<string, unknown>>) ?? [])];
  markers[idx] = { ...markers[idx], [key]: v };
  setProp('markers', markers);
}

function addMarker() {
  if (!props.item) return;
  const markers = [...((props.item.props['markers'] as Array<Record<string, unknown>>) ?? [])];
  markers.push({ source: 'static', lat: 0, lng: 0, label: '' });
  setProp('markers', markers);
}

function removeMarker(idx: number) {
  if (!props.item) return;
  const markers = [...((props.item.props['markers'] as Array<Record<string, unknown>>) ?? [])];
  markers.splice(idx, 1);
  setProp('markers', markers);
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

        <div v-else-if="f.type === 'variable'" class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ f.label }}</span>
          <Dropdown
            class="mt-1"
            :model-value="(item.props[f.key] as string) ?? ''"
            :options="variableOptions"
            placeholder="Select a variable"
            @update:model-value="(v) => selectVariable(f.key, v as string)"
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
              :model-value="(s['variable'] as string) ?? ''"
              :options="variableOptions"
              placeholder="variable"
              size="sm"
              @update:model-value="(v) => updateSeries(idx, 'variable', v)"
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

        <div v-else-if="f.type === 'markers'" class="space-y-3">
          <div class="text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ f.label }}</div>
          <div
            v-for="(m, idx) in (item.props.markers as Array<Record<string, unknown>>) ?? []"
            :key="idx"
            class="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
          >
            <Dropdown
              :model-value="(m['source'] as string) ?? 'static'"
              :options="[
                { value: 'static', label: 'Static coordinates' },
                { value: 'variable', label: 'Lat/Lng variables' },
              ]"
              size="sm"
              @update:model-value="(v) => updateMarker(idx, 'source', v)"
            />
            <div v-if="(m['source'] ?? 'static') === 'variable'" class="space-y-2">
              <Dropdown
                :model-value="(m['latVar'] as string) ?? ''"
                :options="variableOptions"
                placeholder="Latitude variable"
                size="sm"
                @update:model-value="(v) => updateMarker(idx, 'latVar', v)"
              />
              <Dropdown
                :model-value="(m['lngVar'] as string) ?? ''"
                :options="variableOptions"
                placeholder="Longitude variable"
                size="sm"
                @update:model-value="(v) => updateMarker(idx, 'lngVar', v)"
              />
            </div>
            <div v-else class="flex gap-2">
              <input
                :value="m['lat'] ?? 0"
                type="number"
                step="any"
                placeholder="Latitude"
                class="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                @input="updateMarker(idx, 'lat', Number(($event.target as HTMLInputElement).value))"
              />
              <input
                :value="m['lng'] ?? 0"
                type="number"
                step="any"
                placeholder="Longitude"
                class="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                @input="updateMarker(idx, 'lng', Number(($event.target as HTMLInputElement).value))"
              />
            </div>
            <input
              :value="m['label'] ?? ''"
              type="text"
              placeholder="label (optional)"
              class="w-full rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              @input="updateMarker(idx, 'label', ($event.target as HTMLInputElement).value)"
            />
            <Dropdown
              :model-value="(m['valueVar'] as string) ?? ''"
              :options="variableOptions"
              placeholder="value variable (optional)"
              size="sm"
              @update:model-value="(v) => updateMarker(idx, 'valueVar', v)"
            />
            <div class="flex items-center gap-2">
              <input
                :value="(m['color'] as string) || '#ea580c'"
                type="color"
                class="h-7 w-9 shrink-0 cursor-pointer rounded border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950"
                @input="updateMarker(idx, 'color', ($event.target as HTMLInputElement).value)"
              />
              <span class="text-xs text-neutral-500 dark:text-neutral-400">Marker color</span>
            </div>
            <button
              type="button"
              class="w-full rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              @click="removeMarker(idx)"
            >Remove marker</button>
          </div>
          <button
            type="button"
            class="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            @click="addMarker"
          >+ Add marker</button>
        </div>
      </template>
    </div>
  </aside>
</template>
