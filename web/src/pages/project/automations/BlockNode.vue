<script setup lang="ts">
import { computed } from 'vue';
import { Handle, Position } from '@vue-flow/core';
import { connSpec } from '@nodrix/integrations-shared';
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
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Up to two short lines summarising the node's config.
const details = computed<string[]>(() => {
  const c = (props.data.config ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (v === undefined || v === null || v === '' ? '' : String(v));
  const out: string[] = [];

  switch (props.data.kind) {
    case 'variable': {
      out.push(c['operator'] === 'changed'
        ? `${s(c['variable']) || '?'} changed`
        : `${s(c['variable']) || '?'} ${OP[s(c['operator'])] ?? s(c['operator'])} ${s(c['value'])}`.trim());
      const mode = c['mode'] === 'always' ? 'every reading' : 'on entry';
      const cd = Number(c['cooldown_seconds'] ?? 0);
      out.push(cd > 0 ? `${mode} · ${cd}s cooldown` : mode);
      break;
    }
    case 'schedule': {
      out.push(c['time'] ? `at ${s(c['time'])}` : 'no time set');
      const days = Array.isArray(c['days']) ? (c['days'] as number[]) : [];
      out.push(days.length === 0 ? 'every day' : days.slice().sort().map((d) => DAY[d]).join(' '));
      break;
    }
    case 'sunset_sunrise': {
      out.push(s(c['event']) || 'sunset');
      const off = Number(c['offset_minutes'] ?? 0);
      if (off) out.push(`${off > 0 ? '+' : ''}${off} min`);
      break;
    }
    case 'event': out.push(c['event'] ? `"${s(c['event'])}"` : 'no event'); break;
    case 'set_variable': out.push(`${s(c['variable']) || '?'} = ${s(c['value']) || '—'}`); break;
    case 'emit_event': out.push(c['event'] ? `"${s(c['event'])}"` : 'no event'); break;
    case 'call_integration': {
      const i = project.integrations.find((x) => x.id === c['integration_id']);
      out.push(i?.name ?? 'no integration');
      if (i) out.push(connSpec(i.kind).label);
      break;
    }
  }
  return out.filter(Boolean);
});
</script>

<template>
  <div
    class="min-w-[150px] max-w-[220px] rounded-md border bg-white px-2.5 py-2 shadow-sm transition dark:bg-neutral-900"
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
        <div
          v-for="(line, i) in details"
          :key="i"
          class="truncate leading-tight"
          :class="i === 0 ? 'text-[11px] text-neutral-500 dark:text-neutral-400' : 'text-[10px] text-neutral-400 dark:text-neutral-500'"
        >{{ line }}</div>
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
