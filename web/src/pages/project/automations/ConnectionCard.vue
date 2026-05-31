<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectStore } from '../../../stores/project';
import { confirm } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import Icon from '../../../components/Icon.vue';
import Toggle from '../../../components/Toggle.vue';
import StatusPill from '../../../components/StatusPill.vue';
import { connSpec } from './connection-catalog';
import type { Integration, Automation } from '../../../types';

const props = defineProps<{
  integration: Integration;
  usedBy: Automation[];
}>();
const emit = defineEmits<{ edit: [Integration] }>();

const project = useProjectStore();
const spec = computed(() => connSpec(props.integration.kind));
const config = computed(() => (props.integration.config as Record<string, unknown>) ?? {});
const subtitle = computed(() => spec.value.summary(config.value));

const menuOpen = ref(false);
const testing = ref(false);
const testMsg = ref<{ ok: boolean; text: string } | null>(null);

async function toggle() {
  try {
    await project.updateIntegration(props.integration.id, { enabled: !props.integration.enabled });
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function test() {
  testing.value = true;
  testMsg.value = null;
  try {
    const res = await project.testIntegration(props.integration.id);
    testMsg.value = {
      ok: res.status === 'ok',
      text: res.status === 'ok' ? `Delivered${res.detail ? ` (${res.detail})` : ''}` : `${res.status}: ${res.detail ?? ''}`,
    };
    setTimeout(() => { testMsg.value = null; }, 5000);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    testing.value = false;
  }
}

async function remove() {
  menuOpen.value = false;
  const details = ['Kind: ' + spec.value.label];
  if (props.usedBy.length) {
    details.push(`Used by ${props.usedBy.length} automation(s): ${props.usedBy.map((a) => a.name).join(', ')}`);
    details.push('Those automations will fail until reconfigured');
  }
  const ok = await confirm({
    title: `Delete integration "${props.integration.name}"?`,
    message: 'This action cannot be undone.',
    details,
    confirmLabel: 'Delete integration',
  });
  if (!ok) return;
  try {
    await project.deleteIntegration(props.integration.id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div class="flex items-start gap-3 px-3 py-3.5 sm:gap-4 sm:px-4" :class="integration.enabled ? '' : 'opacity-60'">
    <div class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
      <Icon :path="spec.icon" class="h-5 w-5" />
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <span class="truncate text-sm font-semibold">{{ integration.name }}</span>
        <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{{ spec.label }}</span>
        <span v-if="!spec.executable" class="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-amber-700 dark:bg-amber-900/30 dark:text-amber-300" title="Saved but not executed by the runtime yet">coming soon</span>
      </div>
      <div class="mt-0.5 truncate font-mono text-xs text-neutral-500 dark:text-neutral-400" :title="subtitle">{{ subtitle }}</div>
      <div class="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
        <StatusPill :status="integration.last_run_status" :at="integration.last_run_at" never-label="Not delivered yet" />
        <RouterLink
          v-if="usedBy.length"
          :to="`/p/${project.currentProjectId}/automations`"
          class="text-xs text-neutral-500 hover:text-accent-600 dark:text-neutral-400 dark:hover:text-accent-400"
        >Used by {{ usedBy.length }} automation{{ usedBy.length === 1 ? '' : 's' }}</RouterLink>
        <span v-else class="text-xs text-neutral-400 dark:text-neutral-500">Not used yet</span>
      </div>
      <div v-if="testMsg" class="mt-1 text-[11px]" :class="testMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'">{{ testMsg.text }}</div>
    </div>

    <div class="flex shrink-0 items-center gap-1.5 sm:gap-2">
      <button
        v-if="spec.executable"
        type="button"
        :disabled="testing"
        class="rounded-md border border-neutral-300 px-2.5 py-1 text-xs hover:bg-neutral-100 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        @click="test"
      >{{ testing ? 'Testing…' : 'Test' }}</button>
      <Toggle :model-value="integration.enabled" :label="integration.enabled ? 'Disable' : 'Enable'" @update:model-value="toggle" />
      <div class="relative">
        <button type="button" class="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100" title="Actions" @click="menuOpen = !menuOpen">
          <svg viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
        </button>
        <button v-if="menuOpen" type="button" class="fixed inset-0 z-40 cursor-default" aria-hidden="true" @click="menuOpen = false" />
        <div v-if="menuOpen" class="absolute right-0 z-50 mt-1 w-32 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900">
          <button type="button" class="block w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" @click="menuOpen = false; emit('edit', integration)">Edit</button>
          <button type="button" class="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40" @click="remove">Delete</button>
        </div>
      </div>
    </div>
  </div>
</template>
