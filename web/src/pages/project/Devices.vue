<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useProjectStore } from '../../stores/project';
import RevealOnce from '../../components/RevealOnce.vue';
import { confirm } from '../../lib/confirm';
import type { DeviceWithToken } from '../../types';

const project = useProjectStore();
const newName = ref('');
const justCreated = ref<DeviceWithToken | null>(null);
const creating = ref(false);

onMounted(() => project.loadDevices());

async function create() {
  const n = newName.value.trim();
  if (!n) return;
  creating.value = true;
  try {
    justCreated.value = await project.createDevice(n);
    newName.value = '';
  } finally {
    creating.value = false;
  }
}

async function remove(id: string) {
  const dev = project.devices.find((d) => d.id === id);
  const name = dev?.name ?? id;
  const ok = await confirm({
    title: `Delete device "${name}"?`,
    message: 'This action cannot be undone.',
    details: [
      'The device token stops working immediately',
      'All telemetry history in cold storage is deleted',
      'Latest state and recent ring buffer are wiped',
    ],
    confirmLabel: 'Delete device',
  });
  if (!ok) return;
  await project.deleteDevice(id);
}

function fmt(ts: number | null): string {
  return ts ? new Date(ts * 1000).toLocaleString() : '—';
}
</script>

<template>
  <main class="mx-auto max-w-4xl px-6 py-8">
    <h2 class="text-xl font-semibold tracking-tight">Devices</h2>

    <RevealOnce
      v-if="justCreated"
      :value="justCreated.token"
      :label="`Device token for ${justCreated.name}`"
      class="mt-6"
    />

    <form class="mt-6 flex gap-2" @submit.prevent="create">
      <input
        v-model="newName"
        type="text"
        placeholder="New device name"
        class="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <button
        type="submit"
        :disabled="creating"
        class="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
      >Create</button>
    </form>

    <ul class="mt-6 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      <li v-for="d in project.devices" :key="d.id" class="flex items-start justify-between gap-4 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="text-sm font-medium">{{ d.name }}</div>
          <div v-if="d.description" class="mt-0.5 truncate text-xs text-neutral-600 dark:text-neutral-400">{{ d.description }}</div>
          <div class="mt-0.5 font-mono text-xs text-neutral-500 dark:text-neutral-400">{{ d.id }}</div>
        </div>
        <div class="flex items-center gap-3 text-xs text-neutral-500 dark:text-neutral-400">
          <span>last seen: {{ fmt(d.last_seen) }}</span>
          <button
            class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            @click="remove(d.id)"
          >Delete</button>
        </div>
      </li>
      <li v-if="project.devices.length === 0" class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">
        No devices yet.
      </li>
    </ul>
  </main>
</template>
