<script setup lang="ts">
import { computed, watch } from 'vue';
import { useProjectStore } from '../../../stores/project';
import { connOperations, operationFields, connSpec, type IntegrationKind } from '@nodrix/integrations-shared';
import { blockOf, type BlockData } from './graph-edit';
import Dropdown from '../../../components/Dropdown.vue';
import FieldInput from './FieldInput.vue';

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

// ── call_integration: operation + call-site params ────────────────────────────
// Connection config lives on the integration instance; the operation and its
// params are authored here on the action node.
const isCallIntegration = computed(() => props.node.kind === 'call_integration');

const selectedKind = computed<IntegrationKind | null>(() => {
  const found = project.integrations.find((i) => i.id === cfg.value['integration_id']);
  return found ? found.kind : null;
});
const operations = computed(() => (selectedKind.value ? connOperations(selectedKind.value) : []));
const operationOptions = computed(() => operations.value.map((o) => ({ value: o.key, label: o.label })));
const opParams = computed(() =>
  selectedKind.value ? operationFields(selectedKind.value, cfg.value['operation'] as string) : []
);

function params(): Record<string, any> {
  if (!cfg.value['params'] || typeof cfg.value['params'] !== 'object') cfg.value['params'] = {};
  return cfg.value['params'] as Record<string, any>;
}

// Seed param defaults for the active operation; never clobber existing values.
function seedDefaults() {
  if (!selectedKind.value) return;
  const p = params();
  for (const f of operationFields(selectedKind.value, cfg.value['operation'] as string)) {
    if (p[f.key] === undefined && f.default !== undefined) p[f.key] = f.default;
  }
}

// Picking a new integration: snap operation to a valid one, then seed.
watch(selectedKind, (kind) => {
  if (!isCallIntegration.value || !kind) return;
  const ops = connOperations(kind);
  const first = ops[0];
  if (first && !ops.some((o) => o.key === cfg.value['operation'])) {
    cfg.value['operation'] = first.key;
  }
  seedDefaults();
});
// Switching operation: seed the new op's defaults (shared values are kept).
watch(() => cfg.value['operation'], () => { if (isCallIntegration.value) seedDefaults(); });
</script>

<template>
  <div v-if="manifest" class="space-y-3">
    <div class="text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
      {{ manifest.label }}
    </div>
    <p v-if="manifest.fields.length === 0 && !isCallIntegration" class="text-xs text-neutral-500 dark:text-neutral-400">
      No settings — this block has nothing to configure.
    </p>

    <label v-for="f in manifest.fields" :key="f.key" class="block">
      <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ f.label }}</span>

      <Dropdown
        v-if="f.type === 'variable'"
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
      <FieldInput v-else :field="f" v-model="cfg[f.key]" />

      <span v-if="f.hint" class="mt-1 block text-[11px] text-neutral-400 dark:text-neutral-500">{{ f.hint }}</span>
    </label>

    <!-- Operation + call-site params for the chosen integration -->
    <template v-if="isCallIntegration && selectedKind">
      <label v-if="operations.length > 1" class="block">
        <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Operation</span>
        <Dropdown v-model="cfg['operation']" :options="operationOptions" size="sm" class="mt-1 w-full" />
      </label>

      <label v-for="p in opParams" :key="p.key" class="block">
        <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ p.label }}</span>
        <FieldInput :field="p" :model-value="params()[p.key]" @update:model-value="(v) => (params()[p.key] = v)" />
        <span v-if="p.hint" class="mt-1 block text-[11px] text-neutral-400 dark:text-neutral-500">{{ p.hint }}</span>
      </label>
    </template>
  </div>
</template>
