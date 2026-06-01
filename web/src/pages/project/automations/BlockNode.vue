<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import Icon from '../../../components/Icon.vue';
import { useProjectStore } from '../../../stores/project';
import { blockOf, type BlockData } from './graph-edit';

const props = defineProps<{ id: string; data: BlockData; selected?: boolean }>();

const project = useProjectStore();
const manifest = computed(() => blockOf(props.data.kind));
const isTrigger = computed(() => manifest.value?.category === 'trigger');
const hasIn = computed(() => !!manifest.value?.ports.in?.length);
const outPorts = computed(() => manifest.value?.ports.out ?? []);

const OP: Record<string, string> = { '>': '>', '<': '<', '>=': '≥', '<=': '≤', '==': '=', '!=': '≠' };

// A short, human detail line summarising the node's config.
const detail = computed(() => {
  const c = (props.data.config ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (v === undefined || v === null || v === '' ? '' : String(v));
  switch (props.data.kind) {
    case 'variable':
      return c['operator'] === 'changed'
        ? `${s(c['variable']) || '?'} changed`
        : `${s(c['variable']) || '?'} ${OP[s(c['operator'])] ?? s(c['operator'])} ${s(c['value'])}`.trim();
    case 'schedule': return c['time'] ? `at ${s(c['time'])}` : '';
    case 'sunset_sunrise': return s(c['event']) || 'sunset';
    case 'event': return c['event'] ? `"${s(c['event'])}"` : '';
    case 'set_variable': return `${s(c['variable']) || '?'} = ${s(c['value'])}`;
    case 'emit_event': return c['event'] ? `"${s(c['event'])}"` : '';
    case 'call_integration': {
      const i = project.integrations.find((x) => x.id === c['integration_id']);
      return i?.name ?? 'integration';
    }
    default: return '';
  }
});
</script>

<template>
  <div
    class="min-w-[140px] max-w-[210px] rounded-md border bg-white px-2.5 py-1.5 shadow-sm transition dark:bg-neutral-900"
    :class="[
      selected ? 'border-accent-500 ring-1 ring-accent-400' : 'border-neutral-200 dark:border-neutral-700',
    ]"
  >
    <Handle v-if="hasIn" type="target" :position="Position.Left" />

    <div class="flex items-center gap-2">
      <div
        class="grid h-6 w-6 shrink-0 place-items-center rounded"
        :class="isTrigger
          ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
          : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'"
      >
        <Icon :path="manifest?.icon ?? ''" class="h-3.5 w-3.5" />
      </div>
      <div class="min-w-0">
        <div class="truncate text-xs font-semibold leading-tight text-neutral-900 dark:text-neutral-100">
          {{ manifest?.label ?? data.kind }}
        </div>
        <div v-if="detail" class="truncate text-[11px] leading-tight text-neutral-500 dark:text-neutral-400">{{ detail }}</div>
      </div>
    </div>

    <Handle
      v-for="p in outPorts"
      :key="p"
      :id="p"
      type="source"
      :position="Position.Right"
    />
  </div>
</template>
