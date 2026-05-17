<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore } from '../stores/project';

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
  if (!confirm('Delete this dashboard?')) return;
  await project.deleteDashboard(id);
}
</script>

<template>
  <main class="mx-auto max-w-4xl px-6 py-8">
    <h2 class="text-xl font-semibold tracking-tight">Dashboards</h2>

    <ul class="mt-6 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
      <li v-for="d in project.dashboards" :key="d.id" class="flex items-center justify-between px-4 py-3">
        <div>
          <RouterLink :to="`/p/${project.currentProjectId}/d/${d.id}`" class="text-sm font-medium hover:underline">
            {{ d.name }}
          </RouterLink>
          <div class="font-mono text-xs text-neutral-500">{{ d.id }}</div>
        </div>
        <div class="flex items-center gap-2">
          <RouterLink
            :to="`/p/${project.currentProjectId}/d/${d.id}/edit`"
            class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100"
          >Edit</RouterLink>
          <button
            class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
            @click="remove(d.id)"
          >Delete</button>
        </div>
      </li>
      <li v-if="project.dashboards.length === 0" class="px-4 py-6 text-sm text-neutral-500">
        No dashboards yet.
      </li>
    </ul>

    <form class="mt-6 flex gap-2" @submit.prevent="create">
      <input
        v-model="newName"
        type="text"
        placeholder="New dashboard name"
        class="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        :disabled="creating"
        class="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
      >Create</button>
    </form>
  </main>
</template>
