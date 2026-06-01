<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import Icon from '../../../components/Icon.vue';
import { blockOf, type BlockData } from './graph-edit';

const props = defineProps<{ id: string; data: BlockData; selected?: boolean }>();

const manifest = computed(() => blockOf(props.data.kind));
const isTrigger = computed(() => manifest.value?.category === 'trigger');
const hasIn = computed(() => !!manifest.value?.ports.in?.length);
const outPorts = computed(() => manifest.value?.ports.out ?? []);

// One-line subtitle from the most telling config field.
const subtitle = computed(() => {
  const c = props.data.config ?? {};
  const v = c['variable'] ?? c['event'] ?? c['time'] ?? c['integration_id'] ?? c['value'];
  return v === undefined || v === '' ? '' : String(v);
});
</script>

<template>
  <div
    class="min-w-[150px] rounded-lg border bg-white px-3 py-2 shadow-sm transition dark:bg-neutral-900"
    :class="[
      selected ? 'border-accent-500 ring-1 ring-accent-400' : 'border-neutral-200 dark:border-neutral-700',
    ]"
  >
    <Handle v-if="hasIn" type="target" :position="Position.Top" />

    <div class="flex items-center gap-2">
      <div
        class="grid h-7 w-7 shrink-0 place-items-center rounded-md"
        :class="isTrigger
          ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
          : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'"
      >
        <Icon :path="manifest?.icon ?? ''" class="h-4 w-4" />
      </div>
      <div class="min-w-0">
        <div class="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">
          {{ manifest?.label ?? data.kind }}
        </div>
        <div v-if="subtitle" class="truncate text-[11px] text-neutral-500 dark:text-neutral-400">{{ subtitle }}</div>
      </div>
    </div>

    <Handle
      v-for="p in outPorts"
      :key="p"
      :id="p"
      type="source"
      :position="Position.Bottom"
    />
  </div>
</template>
