<script setup lang="ts">
import { computed } from 'vue';
import { useProjectStore } from '../../../stores/project';
import { connSpec } from '@nodrix/integrations-shared';
import { blockOf, type BlockData } from './graph-edit';
import Dropdown from '../../../components/Dropdown.vue';

const props = defineProps<{ node: BlockData }>();

const project = useProjectStore();
const manifest = computed(() => blockOf(props.node.kind));

const WEEKDAYS = [
  { n: 1, label: 'Mon' }, { n: 2, label: 'Tue' }, { n: 3, label: 'Wed' },
  { n: 4, label: 'Thu' }, { n: 5, label: 'Fri' }, { n: 6, label: 'Sat' }, { n: 0, label: 'Sun' },
];

const variableOptions = computed(() => project.variables.map((v) => ({ value: v.key, label: v.key })));
const integrationOptions = computed(() =>
  project.integrations.map((i) => ({ value: i.id, label: i.name, hint: connSpec(i.kind).label }))
);
function selectOptions(opts: readonly string[] = []) {
  return opts.map((o) => ({ value: o, label: o }));
}

// Direct two-way access to a config key on the (reactive) node data. Loosely
// typed: the field set is dynamic (manifest-driven), so v-model binds freely.
const cfg = computed(() => props.node.config as Record<string, any>);
function days(): number[] {
  if (!Array.isArray(cfg.value['days'])) cfg.value['days'] = [];
  return cfg.value['days'] as number[];
}
function toggleDay(n: number) {
  const d = days();
  const i = d.indexOf(n);
  if (i >= 0) d.splice(i, 1); else d.push(n);
}
</script>

<template>
  <div v-if="manifest" class="space-y-3">
    <div class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
      {{ manifest.label }}
    </div>
    <p v-if="manifest.fields.length === 0" class="text-xs text-neutral-500 dark:text-neutral-400">
      No settings — this block has nothing to configure.
    </p>

    <label v-for="f in manifest.fields" :key="f.key" class="block">
      <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ f.label }}</span>

      <Dropdown
        v-if="f.type === 'select'"
        v-model="cfg[f.key]"
        :options="selectOptions(f.options)"
        size="sm"
        class="mt-1 w-full"
      />
      <Dropdown
        v-else-if="f.type === 'variable'"
        v-model="cfg[f.key]"
        :options="variableOptions"
        placeholder="Variable"
        size="sm"
        class="mt-1 w-full"
      />
      <Dropdown
        v-else-if="f.type === 'integration'"
        v-model="cfg[f.key]"
        :options="integrationOptions"
        placeholder="Integration"
        size="sm"
        class="mt-1 w-full"
      />
      <input
        v-else-if="f.type === 'number'"
        v-model.number="cfg[f.key]"
        type="number"
        step="any"
        class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
      <input
        v-else-if="f.type === 'time'"
        v-model="cfg[f.key]"
        type="time"
        class="mt-1 rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      />
      <label v-else-if="f.type === 'boolean'" class="mt-1 inline-flex items-center gap-2 text-sm">
        <input v-model="cfg[f.key]" type="checkbox" class="rounded" />
      </label>
      <textarea
        v-else-if="f.type === 'textarea' || f.type === 'json'"
        v-model="cfg[f.key]"
        rows="3"
        class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
        :placeholder="f.placeholder"
      ></textarea>
      <div v-else-if="f.type === 'weekdays'" class="mt-1 flex flex-wrap gap-1.5">
        <button
          v-for="d in WEEKDAYS"
          :key="d.n"
          type="button"
          class="rounded-md border px-2.5 py-1 text-xs"
          :class="days().includes(d.n)
            ? 'border-accent-500 bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
            : 'border-neutral-300 text-neutral-600 dark:border-neutral-700 dark:text-neutral-300'"
          @click="toggleDay(d.n)"
        >{{ d.label }}</button>
      </div>
      <input
        v-else
        v-model="cfg[f.key]"
        type="text"
        :class="f.mono ? 'font-mono' : ''"
        class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        :placeholder="f.placeholder"
      />

      <span v-if="f.hint" class="mt-1 block text-[11px] text-neutral-400 dark:text-neutral-500">{{ f.hint }}</span>
    </label>
  </div>
</template>
