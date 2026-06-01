<script setup lang="ts">
import { reactive, ref, computed, onMounted } from 'vue';
import { useProjectStore } from '../../../stores/project';
import Icon from '../../../components/Icon.vue';
import FieldInput from './FieldInput.vue';
import { toast } from '../../../lib/toast';
import { connSpec, connectionFields } from '@nodrix/integrations-shared';
import type { Integration, IntegrationKind } from '../../../types';

const props = defineProps<{
  kind: IntegrationKind;
  integration?: Integration | null;
}>();
const emit = defineEmits<{ saved: []; cancel: [] }>();

const project = useProjectStore();
const spec = computed(() => connSpec(props.kind));
// Only connection-level fields belong on the instance; operation params are
// authored on the automation's call_integration node.
const fields = computed(() => connectionFields(props.kind));

const name = ref('');
const values = reactive<Record<string, string>>({});
const submitting = ref(false);

onMounted(() => {
  const cfg = (props.integration?.config as Record<string, unknown> | null) ?? null;
  name.value = props.integration?.name ?? '';
  for (const f of fields.value) {
    const raw = cfg ? cfg[f.key] : undefined;
    if (f.type === 'json') {
      values[f.key] = raw && typeof raw === 'object' ? JSON.stringify(raw, null, 2) : '';
    } else if (raw != null) {
      values[f.key] = String(raw);
    } else {
      values[f.key] = f.default ?? '';
    }
  }
});

function buildConfig(): Record<string, unknown> | null {
  const config: Record<string, unknown> = {};
  for (const f of fields.value) {
    const v = (values[f.key] ?? '').trim();
    if (!v) {
      if (f.required) { toast.error(`${f.label} is required.`); return null; }
      continue;
    }
    if (f.type === 'json') {
      try { config[f.key] = JSON.parse(v); }
      catch { toast.error(`${f.label} must be valid JSON.`); return null; }
    } else {
      config[f.key] = values[f.key];
    }
  }
  return config;
}

async function submit() {
  const n = name.value.trim();
  if (!n) { toast.error('Name is required.'); return; }
  const config = buildConfig();
  if (config === null) return;

  submitting.value = true;
  try {
    if (props.integration) {
      await project.updateIntegration(props.integration.id, { name: n, config });
    } else {
      await project.createIntegration({ name: n, kind: props.kind, config });
    }
    emit('saved');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <form class="rounded-xl border border-neutral-200 bg-white p-4 sm:p-5 dark:border-neutral-800 dark:bg-neutral-900" @submit.prevent="submit">
    <div class="mb-4 flex items-center gap-3">
      <div class="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
        <Icon :path="spec.icon" class="h-5 w-5" />
      </div>
      <div class="min-w-0">
        <div class="text-sm font-semibold text-neutral-900 dark:text-neutral-100">{{ integration ? 'Edit' : 'New' }} {{ spec.label }}</div>
        <div class="truncate text-xs text-neutral-500 dark:text-neutral-400">{{ spec.description }}</div>
      </div>
    </div>

    <div v-if="!spec.executable" class="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-700 dark:border-amber-900/40 dark:bg-amber-900/20 dark:text-amber-300">
      {{ spec.label }} isn't executed by the runtime yet — it's saved for when its connector lands.
    </div>

    <label class="block">
      <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Name</span>
      <input v-model="name" type="text" required class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" :placeholder="`e.g. ${spec.label} alerts`" />
    </label>

    <div v-for="f in fields" :key="f.key" class="mt-3">
      <label class="block">
        <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">{{ f.label }}</span>
        <FieldInput :field="f" v-model="values[f.key]" />
      </label>
      <p v-if="f.hint" class="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">{{ f.hint }}</p>
    </div>

    <div class="mt-4 flex justify-end gap-2">
      <button type="button" class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="emit('cancel')">Cancel</button>
      <button type="submit" :disabled="submitting || !name.trim()" class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50">
        {{ submitting ? 'Saving…' : integration ? 'Save changes' : 'Create' }}
      </button>
    </div>
  </form>
</template>
