<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useProjectStore } from '../../stores/project';
import RevealOnce from '../../components/RevealOnce.vue';
import { confirm } from '../../lib/confirm';
import type { ProjectTokenWithSecret } from '../../types';

const project = useProjectStore();
const newKey = ref('');
const creating = ref(false);
const justCreatedToken = ref<ProjectTokenWithSecret | null>(null);
const creatingToken = ref(false);

onMounted(() => {
  project.loadVariables();
  project.loadProjectTokens();
});

async function createVariable() {
  const key = newKey.value.trim();
  if (!key) return;
  creating.value = true;
  try {
    await project.createVariable({ key });
    newKey.value = '';
  } finally {
    creating.value = false;
  }
}

async function saveName(id: string, e: Event) {
  await project.updateVariable(id, { name: (e.target as HTMLInputElement).value.trim() || null });
}

async function saveUnit(id: string, e: Event) {
  await project.updateVariable(id, { unit: (e.target as HTMLInputElement).value.trim() || null });
}

async function removeVariable(id: string) {
  const v = project.variables.find((x) => x.id === id);
  const key = v?.key ?? id;
  const ok = await confirm({
    title: `Delete variable "${key}"?`,
    message: 'This action cannot be undone.',
    details: [
      'Latest value and recent history are wiped',
      'Widgets bound to this variable stop updating',
      'It will re-appear if hardware posts to this key again',
    ],
    confirmLabel: 'Delete variable',
  });
  if (!ok) return;
  await project.deleteVariable(id);
}

async function createToken() {
  creatingToken.value = true;
  try {
    justCreatedToken.value = await project.createProjectToken(null);
  } finally {
    creatingToken.value = false;
  }
}

async function revokeToken(id: string) {
  const ok = await confirm({
    title: 'Revoke this connection token?',
    message: 'Any hardware using it will stop being able to post telemetry immediately.',
    confirmLabel: 'Revoke token',
  });
  if (!ok) return;
  await project.revokeProjectToken(id);
}

function fmt(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toLocaleString() : '—';
}
</script>

<template>
  <main class="mx-auto max-w-4xl px-6 py-8">
    <h2 class="text-xl font-semibold tracking-tight">Variables</h2>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      Project-scoped data points. New keys appear automatically the first time hardware posts to them.
    </p>

    <form class="mt-6 flex gap-2" @submit.prevent="createVariable">
      <input
        v-model="newKey"
        type="text"
        placeholder="New variable key (e.g. pm25)"
        class="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <button
        type="submit"
        :disabled="creating"
        class="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
      >Add</button>
    </form>

    <ul class="mt-6 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      <li v-for="v in project.variables" :key="v.id" class="flex items-center justify-between gap-4 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="font-mono text-sm font-medium">{{ v.key }}</div>
          <div class="mt-1 flex gap-2">
            <input
              :value="v.name ?? ''"
              type="text"
              placeholder="display name"
              class="w-40 rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              @change="saveName(v.id, $event)"
            />
            <input
              :value="v.unit ?? ''"
              type="text"
              placeholder="unit"
              class="w-20 rounded border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              @change="saveUnit(v.id, $event)"
            />
          </div>
        </div>
        <div class="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
          <span>last seen: {{ fmt(v.last_seen) }}</span>
          <button
            class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            @click="removeVariable(v.id)"
          >Delete</button>
        </div>
      </li>
      <li v-if="project.variables.length === 0" class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">
        No variables yet. Post telemetry or add one above.
      </li>
    </ul>

    <!-- Connection tokens -->
    <h3 class="mt-10 text-lg font-semibold tracking-tight">Connection tokens</h3>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      Hardware authenticates with a project token to post telemetry and poll for control writes.
    </p>

    <RevealOnce
      v-if="justCreatedToken"
      :value="justCreatedToken.token"
      label="Project connection token"
      class="mt-4"
    />

    <div class="mt-4">
      <button
        type="button"
        :disabled="creatingToken"
        class="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
        @click="createToken"
      >Create token</button>
    </div>

    <ul class="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      <li v-for="t in project.projectTokens" :key="t.id" class="flex items-center justify-between gap-4 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="font-mono text-xs text-neutral-500 dark:text-neutral-400">{{ t.id }}</div>
          <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            created {{ fmt(t.created_at) }} · last used {{ fmt(t.last_used_at) }}
          </div>
        </div>
        <div class="flex items-center gap-3 text-xs">
          <span v-if="t.revoked_at" class="rounded-full bg-neutral-200 px-2 py-0.5 uppercase tracking-wide text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">revoked</span>
          <button
            v-else
            class="rounded-md border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            @click="revokeToken(t.id)"
          >Revoke</button>
        </div>
      </li>
      <li v-if="project.projectTokens.length === 0" class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">
        No connection tokens yet.
      </li>
    </ul>
  </main>
</template>
