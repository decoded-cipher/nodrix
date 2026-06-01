<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore } from '../../../stores/project';
import { confirm } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import Toggle from '../../../components/Toggle.vue';
import StatusPill from '../../../components/StatusPill.vue';
import FlowChip from '../../../components/FlowChip.vue';
import { triggerSpec, triggerSummary, triggerChipLabel, actionChips } from './automation-catalog';
import type { Automation } from '../../../types';

const props = defineProps<{
  automation: Automation;
  variableLabel: (key: string) => string;
  integration: (id: string) => { name: string; icon: string } | undefined;
}>();

const project = useProjectStore();
const router = useRouter();

const menuOpen = ref(false);
const running = ref(false);
const runMsg = ref<{ ok: boolean; text: string } | null>(null);

const spec = computed(() => triggerSpec(props.automation.trigger_type));
const resolvers = computed(() => ({ variableLabel: props.variableLabel, integration: props.integration }));
const cfg = computed(() => props.automation.trigger_config as Record<string, unknown>);
const triggerLabel = computed(() => triggerChipLabel(props.automation.trigger_type, cfg.value, resolvers.value));
const triggerTitle = computed(() => triggerSummary(props.automation.trigger_type, cfg.value, { variableLabel: props.variableLabel }));
const chips = computed(() => actionChips(props.automation.actions, resolvers.value));

function edit() {
  router.push({ name: 'automation-editor', params: { id: props.automation.id } });
}

async function toggle() {
  try {
    await project.updateAutomation(props.automation.id, { enabled: !props.automation.enabled });
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function run() {
  menuOpen.value = false;
  running.value = true;
  try {
    const res = await project.runAutomation(props.automation.id);
    runMsg.value = {
      ok: res.status !== 'error',
      text: res.status === 'error' ? (res.error ?? 'error') : `${res.status} · ran ${res.actionsRun} action(s)`,
    };
    setTimeout(() => { runMsg.value = null; }, 4000);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    running.value = false;
  }
}

async function duplicate() {
  menuOpen.value = false;
  try {
    await project.createAutomation({
      name: `${props.automation.name} (copy)`,
      description: props.automation.description,
      trigger_type: props.automation.trigger_type,
      trigger_config: props.automation.trigger_config,
      actions: props.automation.actions,
    });
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function remove() {
  menuOpen.value = false;
  const ok = await confirm({
    title: `Delete automation "${props.automation.name}"?`,
    message: 'This action cannot be undone.',
    details: [
      `Trigger: ${spec.value.title}`,
      props.automation.enabled ? 'Currently enabled — it will stop running' : 'Currently disabled',
    ],
    confirmLabel: 'Delete automation',
  });
  if (!ok) return;
  try {
    await project.deleteAutomation(props.automation.id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div
    class="rounded-xl border border-neutral-200 bg-white p-4 transition hover:border-neutral-300 dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-neutral-700"
    :class="automation.enabled ? '' : 'opacity-60'"
  >
    <!-- Header -->
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <h3 class="truncate text-sm font-semibold text-neutral-900 dark:text-neutral-100">{{ automation.name }}</h3>
          <span class="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">{{ spec.title }}</span>
        </div>
        <p v-if="automation.description" class="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400">{{ automation.description }}</p>
      </div>

      <div class="flex shrink-0 items-center gap-2">
        <Toggle :model-value="automation.enabled" :label="automation.enabled ? 'Disable' : 'Enable'" @update:model-value="toggle" />
        <div class="relative">
          <button
            type="button"
            class="rounded-md p-1.5 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
            :title="running ? 'Running…' : 'Actions'"
            @click="menuOpen = !menuOpen"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" class="h-5 w-5"><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></svg>
          </button>

          <button v-if="menuOpen" type="button" class="fixed inset-0 z-40 cursor-default" aria-hidden="true" @click="menuOpen = false" />
          <div
            v-if="menuOpen"
            class="absolute right-0 z-50 mt-1 w-36 overflow-hidden rounded-md border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-700 dark:bg-neutral-900"
          >
            <button type="button" class="block w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" @click="run">Run now</button>
            <button type="button" class="block w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" @click="menuOpen = false; edit()">Edit</button>
            <button type="button" class="block w-full px-3 py-1.5 text-left hover:bg-neutral-100 dark:hover:bg-neutral-800" @click="duplicate">Duplicate</button>
            <button type="button" class="block w-full px-3 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40" @click="remove">Delete</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Rule flow: trigger → actions -->
    <div class="mt-3 flex flex-wrap items-center gap-1.5">
      <FlowChip tone="trigger" :icon="spec.icon" :label="triggerLabel" :title="triggerTitle" />
      <template v-if="chips.length">
        <template v-for="(c, i) in chips" :key="i">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
          <FlowChip tone="action" :icon="c.icon" :label="c.label" />
        </template>
      </template>
      <template v-else>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="h-3.5 w-3.5 shrink-0 text-neutral-300 dark:text-neutral-600"><path stroke-linecap="round" stroke-linejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" /></svg>
        <span class="text-xs italic text-neutral-400 dark:text-neutral-500">No actions yet</span>
      </template>
    </div>

    <!-- Footer: status -->
    <div class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-neutral-100 pt-2.5 dark:border-neutral-800">
      <StatusPill :status="automation.last_run_status" :at="automation.last_run_at" />
      <span
        v-if="runMsg"
        class="text-[11px]"
        :class="runMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'"
      >{{ runMsg.text }}</span>
    </div>
  </div>
</template>
