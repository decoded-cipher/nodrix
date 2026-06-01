<script setup lang="ts">
// Renders one scalar manifest field (block field or integration param). The
// data-bound special types (variable / integration / weekdays) stay in
// NodeInspector since they need project data; everything else lives here so the
// node inspector and the integration form share one widget set.
import { computed } from 'vue';
import Dropdown from '../../../components/Dropdown.vue';

type Field = {
  type: string;
  key: string;
  options?: readonly string[];
  placeholder?: string;
  mono?: boolean;
};

const props = defineProps<{ field: Field; modelValue: unknown }>();
const emit = defineEmits<{ 'update:modelValue': [unknown] }>();

const value = computed({
  get: () => props.modelValue as any,
  set: (v) => emit('update:modelValue', v),
});

const selectOptions = computed(() => (props.field.options ?? []).map((o) => ({ value: o, label: o })));

const base =
  'mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950';
</script>

<template>
  <Dropdown
    v-if="field.type === 'select'"
    v-model="value"
    :options="selectOptions"
    size="sm"
    class="mt-1 w-full"
  />
  <input v-else-if="field.type === 'number'" v-model.number="value" type="number" step="any" :class="base" />
  <input v-else-if="field.type === 'time'" v-model="value" type="time" :class="base" />
  <label v-else-if="field.type === 'boolean'" class="mt-1 inline-flex items-center gap-2 text-sm">
    <input v-model="value" type="checkbox" class="rounded" />
  </label>
  <textarea
    v-else-if="field.type === 'textarea' || field.type === 'json'"
    v-model="value"
    rows="3"
    :placeholder="field.placeholder"
    class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950"
  ></textarea>
  <textarea
    v-else-if="field.type === 'code'"
    v-model="value"
    rows="8"
    :placeholder="field.placeholder"
    class="mt-1 w-full rounded-md border border-neutral-300 bg-neutral-950 px-2 py-1.5 font-mono text-xs text-neutral-100 dark:border-neutral-700"
  ></textarea>
  <input
    v-else
    v-model="value"
    :type="field.type === 'url' ? 'url' : 'text'"
    :placeholder="field.placeholder"
    :class="[base, field.mono ? 'font-mono text-xs' : '']"
  />
</template>
