<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useProjectStore } from '../../../stores/project';
import { toast } from '../../../lib/toast';
import Spinner from '../../../components/Spinner.vue';

const project = useProjectStore();
const route = useRoute();
const loading = ref(true);

watch(
  () => project.currentProjectId,
  async (id) => {
    if (!id) return;
    try {
      await Promise.all([project.loadDevices(), project.loadFirmware(), project.loadDeviceState()]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      loading.value = false;
    }
  },
  { immediate: true }
);

const REFRESH_MS = 15_000;
const timer = setInterval(() => {
  if (document.hidden || !project.currentProjectId) return;
  Promise.all([project.loadDevices(), project.loadDeviceState()]).catch(() => {});
}, REFRESH_MS);
onBeforeUnmount(() => clearInterval(timer));

const proj = computed(() => project.currentProjectId ?? '');

const tabs = computed(() => [
  { name: 'devices', label: 'Devices', to: `/p/${proj.value}/device`, count: project.listedDevices.length },
  { name: 'firmware', label: 'Firmware', to: `/p/${proj.value}/device/firmware`, count: project.firmware.length },
]);

const activeName = computed(() => (route.name === 'device-firmware' ? 'firmware' : 'devices'));

const ONLINE_WINDOW_S = 5 * 60;
const onlineCount = computed(() => {
  const now = Math.floor(Date.now() / 1000);
  return project.listedDevices.filter((d) => d.last_seen && now - d.last_seen < ONLINE_WINDOW_S).length;
});
const updatingCount = computed(() => project.listedDevices.filter((d) => d.ota_status === 'pending').length);
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
    <header class="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 class="text-xl font-semibold tracking-tight">Devices</h1>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          The boards reporting to this project, and the firmware they update to over the air.
        </p>
      </div>
      <div v-if="!loading && project.listedDevices.length" class="flex shrink-0 items-center gap-2 text-xs">
        <span class="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 px-2.5 py-1 text-neutral-600 dark:border-neutral-800 dark:text-neutral-300">
          <span class="h-1.5 w-1.5 rounded-full" :class="onlineCount ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-600'" />
          {{ onlineCount }} of {{ project.listedDevices.length }} online
        </span>
        <span
          v-if="updatingCount"
          class="inline-flex items-center gap-1.5 rounded-full border border-accent-200 bg-accent-50 px-2.5 py-1 text-accent-700 dark:border-accent-900 dark:bg-accent-950/40 dark:text-accent-300"
        >
          <span class="h-1.5 w-1.5 animate-pulse rounded-full bg-accent-500" />
          {{ updatingCount }} updating
        </span>
      </div>
    </header>

    <div class="mb-6 border-b border-neutral-200 dark:border-neutral-800">
      <nav class="-mb-px flex gap-6 text-sm">
        <RouterLink
          v-for="t in tabs"
          :key="t.name"
          :to="t.to"
          class="border-b-2 px-1 pb-2.5 font-medium transition"
          :class="activeName === t.name
            ? 'border-accent-600 text-accent-700 dark:text-accent-400'
            : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'"
        >
          {{ t.label }}
          <span class="ml-1.5 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{{ t.count }}</span>
        </RouterLink>
      </nav>
    </div>

    <div v-if="loading" class="flex justify-center py-10">
      <Spinner size="sm" label="Loading devices…" />
    </div>
    <RouterView v-else />
  </div>
</template>
