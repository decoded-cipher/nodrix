<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore } from '../../../stores/project';
import { confirm } from '../../../lib/confirm';
import Icon from '../../../components/Icon.vue';
import Toggle from '../../../components/Toggle.vue';
import StatusPill from '../../../components/StatusPill.vue';
import { triggerSpec, triggerSummary, actionSummary } from './automation-catalog';
import type { Automation } from '../../../types';

const props = defineProps<{
  automation: Automation;
  variableLabel: (key: string) => string;
  integrationLabel: (id: string) => string;
}>();

const project = useProjectStore();
const router = useRouter();

const menuOpen = ref(false);
const running = ref(false);
const runMsg = ref<{ ok: boolean; text: string } | null>(null);

const spec = computed(() => triggerSpec(props.automation.trigger_type));
const when = computed(() =>
  triggerSummary(props.automation.trigger_type, props.automation.trigger_config as Record<string, unknown>, {
    variableLabel: props.variableLabel,
  })
);
const thens = computed(() =>
  actionSummary(props.automation.actions, {
    variableLabel: props.variableLabel,
    integrationLabel: props.integrationLabel,
  })
);

function edit() {
  router.push({ name: 'automation-editor', params: { id: props.automation.id } });
}

async function toggle() {
  await project.updateAutomation(props.automation.id, { enabled: !props.automation.enabled });
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
  } finally {
    running.value = false;
  }
}

async function duplicate() {
  menuOpen.value = false;
  await project.createAutomation({
    name: `${props.automation.name} (copy)`,
    description: props.automation.description,
    trigger_type: props.automation.trigger_type,
    trigger_config: props.automation.trigger_config,
    actions: props.automation.actions,
  });
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
  await project.deleteAutomation(props.automation.id);
}
</script>

<template>
  <div
    class="flex items-start gap-4 px-4 py-3.5"
    :class="automation.enabled ? '' : 'opacity-60'"
  >
    <!-- Trigger icon -->
    <div class="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
      <Icon :path="spec.icon" class="h-5 w-5" />
    </div>

    <!-- Body -->
    <div class="min-w-0 flex-1">
      <div class="flex flex-wrap items-center gap-2">
        <span class="truncate text-sm font-semibold">{{ automation.name }}</span>
        <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{{ spec.title }}</span>
      </div>
      <div class="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{{ when }}</div>
      <div v-if="thens.length" class="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-neutral-500 dark:text-neutral-400">
        <span class="text-neutral-400 dark:text-neutral-500">→</span>
        <template v-for="(t, i) in thens" :key="i">
          <span class="rounded bg-neutral-100 px-1.5 py-0.5 dark:bg-neutral-800">{{ t }}</span>
        </template>
      </div>
      <div v-else class="mt-1 text-xs italic text-neutral-400 dark:text-neutral-500">No actions yet</div>
      <div class="mt-1.5">
        <StatusPill :status="automation.last_run_status" :at="automation.last_run_at" />
      </div>
      <div
        v-if="runMsg"
        class="mt-1 text-[11px]"
        :class="runMsg.ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'"
      >{{ runMsg.text }}</div>
    </div>

    <!-- Controls -->
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
</template>
