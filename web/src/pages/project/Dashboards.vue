<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore } from '../../stores/project';
import { confirm } from '../../lib/confirm';

const project = useProjectStore();
const router = useRouter();

const newName = ref('');
const creating = ref(false);

async function create() {
  const n = newName.value.trim();
  if (!n) return;
  creating.value = true;
  try {
    const d = await project.createDashboard(n);
    router.push(`/p/${project.currentProjectId}/d/${d.id}/edit`);
  } finally {
    creating.value = false;
    newName.value = '';
  }
}

async function remove(id: string) {
  const dash = project.dashboards.find((d) => d.id === id);
  const name = dash?.name ?? id;
  const ok = await confirm({
    title: `Delete dashboard "${name}"?`,
    message: 'This action cannot be undone.',
    details: [
      'The layout is removed and open viewers are disconnected',
      'Telemetry from the devices it referenced is not affected',
    ],
    confirmLabel: 'Delete dashboard',
  });
  if (!ok) return;
  await project.deleteDashboard(id);
}
</script>

<template>
  <main class="mx-auto max-w-4xl px-6 py-8">
    <h2 class="text-xl font-semibold tracking-tight">Dashboards</h2>

    <ul class="mt-6 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      <li v-for="d in project.dashboards" :key="d.id" class="flex items-center justify-between px-4 py-3">
        <div>
          <RouterLink :to="`/p/${project.currentProjectId}/d/${d.id}`" class="text-sm font-medium hover:underline">
            {{ d.name }}
          </RouterLink>
          <div class="font-mono text-xs text-neutral-500 dark:text-neutral-400">{{ d.id }}</div>
        </div>
        <div class="flex items-center gap-2">
          <RouterLink
            :to="`/p/${project.currentProjectId}/d/${d.id}/edit`"
            class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
          >Edit</RouterLink>
          <button
            class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            @click="remove(d.id)"
          >Delete</button>
        </div>
      </li>
      <li v-if="project.dashboards.length === 0" class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">
        No dashboards yet.
      </li>
    </ul>

    <form class="mt-6 flex gap-2" @submit.prevent="create">
      <input
        v-model="newName"
        type="text"
        placeholder="New dashboard name"
        class="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <button
        type="submit"
        :disabled="creating"
        class="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
      >Create</button>
    </form>
  </main>
</template>
