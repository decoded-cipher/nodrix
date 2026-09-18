<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { RouterLink, RouterView, useRoute } from 'vue-router';
import { useProjectStore } from '../../../stores/project';
import { toast } from '../../../lib/toast';
import Spinner from '../../../components/Spinner.vue';

const project = useProjectStore();
const route = useRoute();
const loading = ref(true);

onMounted(async () => {
  try {
    await Promise.all([project.loadDevices(), project.loadFirmware()]);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
});

const proj = computed(() => project.currentProjectId ?? '');

const tabs = computed(() => [
  { name: 'devices', label: 'Devices', to: `/p/${proj.value}/device`, count: project.devices.length },
  { name: 'firmware', label: 'Firmware', to: `/p/${proj.value}/device/firmware`, count: project.firmware.length },
]);

const activeName = computed(() => (route.name === 'device-firmware' ? 'firmware' : 'devices'));
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
    <header class="mb-5">
      <h1 class="text-xl font-semibold tracking-tight">Devices</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        The boards reporting to this project — and the firmware they can pull over the air.
      </p>
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
