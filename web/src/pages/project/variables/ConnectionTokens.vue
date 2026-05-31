<script setup lang="ts">
import { ref } from 'vue';
import { useProjectStore } from '../../../stores/project';
import RevealOnce from '../../../components/RevealOnce.vue';
import { confirm } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import type { ProjectTokenWithSecret } from '../../../types';

const project = useProjectStore();
const justCreatedToken = ref<ProjectTokenWithSecret | null>(null);
const creatingToken = ref(false);

async function createToken() {
  creatingToken.value = true;
  try {
    justCreatedToken.value = await project.createProjectToken(null);
  } catch (e) {
    toast.error((e as Error).message);
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
  try {
    await project.revokeProjectToken(id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

function fmt(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toLocaleString() : '—';
}
</script>

<template>
  <div>
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <p class="max-w-xl text-sm text-neutral-600 dark:text-neutral-400">
        Hardware authenticates with a project token to post telemetry and poll for control writes.
        The secret is shown once at creation — store it safely.
      </p>
      <button
        type="button"
        :disabled="creatingToken"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
        @click="createToken"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>
        Create token
      </button>
    </div>

    <RevealOnce
      v-if="justCreatedToken"
      :value="justCreatedToken.token"
      label="Project connection token"
      class="mt-4"
    />

    <ul class="mt-4 divide-y divide-neutral-200 overflow-hidden rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      <li v-for="t in project.projectTokens" :key="t.id" class="flex items-center justify-between gap-4 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="truncate font-mono text-xs text-neutral-500 dark:text-neutral-400">{{ t.id }}</div>
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
      <li v-if="project.projectTokens.length === 0" class="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
        No connection tokens yet. Create one to connect your first device.
      </li>
    </ul>
  </div>
</template>
