<script setup lang="ts">
import { computed, inject, ref, type Ref } from 'vue';
import Dropdown from '../components/Dropdown.vue';
import Toggle from '../components/Toggle.vue';
import type { WidgetField } from '@nodrix/widgets-shared';

defineOptions({ name: 'ConfigField' });

const props = defineProps<{ field: WidgetField; model: Record<string, unknown> }>();
const emit = defineEmits<{ change: [key: string, value: unknown] }>();

type VarOption = { value: string; label: string; hint?: string };
const variableOptions = inject<Ref<VarOption[]>>('variableOptions', ref([]));

const rows = computed<Array<Record<string, unknown>>>(() => {
  const v = props.field.key ? props.model[props.field.key] : undefined;
  return Array.isArray(v) ? (v as Array<Record<string, unknown>>) : [];
});

function isVisible(f: WidgetField, m: Record<string, unknown>): boolean {
  return !f.showWhen || m[f.showWhen.key] === f.showWhen.equals;
}

function selectOptions(f: WidgetField) {
  return (f.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
}

function typeDefault(f: WidgetField): unknown {
  if (f.default !== undefined) return f.default;
  if (f.type === 'number') return 0;
  if (f.type === 'boolean') return false;
  if (f.type === 'color') return '#000000';
  return '';
}

function buildRow(fields: ReadonlyArray<WidgetField>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const f of fields) {
    if (f.type === 'group' && f.fields) Object.assign(row, buildRow(f.fields));
    else if (f.key) row[f.key] = typeDefault(f);
  }
  return row;
}

function updateRow(idx: number, key: string, value: unknown) {
  emit('change', props.field.key as string, rows.value.map((r, i) => (i === idx ? { ...r, [key]: value } : r)));
}
function addRow() {
  emit('change', props.field.key as string, [...rows.value, buildRow(props.field.fields ?? [])]);
}
function removeRow(idx: number) {
  emit('change', props.field.key as string, rows.value.filter((_, i) => i !== idx));
}

const inputCls = 'w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100';
const labelCls = 'block text-xs font-medium text-neutral-600 dark:text-neutral-300';
</script>

<template>
  <label v-if="field.type === 'string'" class="block">
    <span v-if="field.label" :class="labelCls">{{ field.label }}</span>
    <input
      :value="model[field.key as string] ?? ''"
      type="text"
      :placeholder="field.placeholder"
      :class="['mt-1', inputCls]"
      @input="emit('change', field.key as string, ($event.target as HTMLInputElement).value)"
    />
  </label>

  <label v-else-if="field.type === 'number'" class="block">
    <span v-if="field.label" :class="labelCls">{{ field.label }}</span>
    <div class="mt-1 flex items-center gap-1.5">
      <input
        :value="model[field.key as string] ?? 0"
        type="number"
        :placeholder="field.placeholder"
        :class="inputCls"
        @input="emit('change', field.key as string, Number(($event.target as HTMLInputElement).value))"
      />
      <span v-if="field.suffix" class="text-xs text-neutral-500 dark:text-neutral-400">{{ field.suffix }}</span>
    </div>
  </label>

  <div v-else-if="field.type === 'boolean'" class="flex items-center justify-between">
    <span class="text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ field.label }}</span>
    <Toggle
      :model-value="Boolean(model[field.key as string])"
      :label="field.label"
      @update:model-value="(v) => emit('change', field.key as string, v)"
    />
  </div>

  <div v-else-if="field.type === 'variable'" class="block">
    <span v-if="field.label" :class="labelCls">{{ field.label }}</span>
    <Dropdown
      class="mt-1"
      :model-value="(model[field.key as string] as string) ?? ''"
      :options="variableOptions"
      :placeholder="field.placeholder ?? 'Select a variable'"
      @update:model-value="(v) => emit('change', field.key as string, v as string)"
    />
  </div>

  <div v-else-if="field.type === 'select'" class="block">
    <span v-if="field.label" :class="labelCls">{{ field.label }}</span>
    <Dropdown
      class="mt-1"
      :model-value="(model[field.key as string] as string) ?? ''"
      :options="selectOptions(field)"
      :placeholder="field.placeholder"
      @update:model-value="(v) => emit('change', field.key as string, v)"
    />
  </div>

  <label v-else-if="field.type === 'color'" class="block">
    <span v-if="field.label" :class="labelCls">{{ field.label }}</span>
    <input
      :value="(model[field.key as string] as string) || '#000000'"
      type="color"
      class="mt-1 h-9 w-full cursor-pointer rounded-md border border-neutral-300 bg-white dark:border-neutral-700 dark:bg-neutral-950"
      @input="emit('change', field.key as string, ($event.target as HTMLInputElement).value)"
    />
  </label>

  <div v-else-if="field.type === 'group'" class="flex gap-2">
    <template v-for="(child, i) in field.fields ?? []" :key="child.key ?? i">
      <ConfigField
        v-if="isVisible(child, model)"
        class="flex-1 min-w-0"
        :field="child"
        :model="model"
        @change="(k, v) => emit('change', k, v)"
      />
    </template>
  </div>

  <div v-else-if="field.type === 'block'" class="space-y-3">
    <div v-if="field.label" class="text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ field.label }}</div>
    <div
      v-for="(row, idx) in rows"
      :key="idx"
      class="space-y-2 rounded-md border border-neutral-200 p-3 dark:border-neutral-800"
    >
      <template v-for="(child, i) in field.fields ?? []" :key="child.key ?? i">
        <ConfigField
          v-if="isVisible(child, row)"
          :field="child"
          :model="row"
          @change="(k, v) => updateRow(idx, k, v)"
        />
      </template>
      <button
        type="button"
        class="w-full rounded border border-red-200 px-2 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
        @click="removeRow(idx)"
      >{{ field.removeLabel ?? 'Remove' }}</button>
    </div>
    <button
      type="button"
      class="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
      @click="addRow"
    >+ {{ field.addLabel ?? 'Add' }}</button>
  </div>
</template>
