<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../../stores/session';
import { useProjectStore } from '../../stores/project';

const session = useSessionStore();
const project = useProjectStore();
const router = useRouter();

const current = computed(() => session.projects.find((p) => p.id === project.currentProjectId));
const canDelete = computed(() => session.projects.length > 1);

async function deleteProject() {
  if (!current.value) return;
  if (!confirm(`Permanently delete project "${current.value.name}" and everything in it?`)) return;
  await session.deleteProject(current.value.id);
  router.replace('/');
}
</script>

<template>
  <main class="mx-auto max-w-2xl px-6 py-8">
    <h2 class="text-xl font-semibold tracking-tight">Settings</h2>

    <section class="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
      <div class="text-sm font-medium">Project</div>
      <div class="mt-2 text-sm">{{ current?.name }}</div>
      <div class="mt-1 font-mono text-xs text-neutral-500">{{ current?.id }}</div>
    </section>

    <section class="mt-6 rounded-lg border border-red-200 bg-red-50 p-4">
      <div class="text-sm font-medium text-red-900">Danger zone</div>
      <p class="mt-1 text-xs text-red-800">
        Deletes all devices, dashboards, and tokens scoped to this project. Telemetry already
        written to R2 is not removed.
      </p>
      <button
        :disabled="!canDelete"
        class="mt-3 rounded-md border border-red-300 bg-white px-3 py-2 text-sm text-red-700 hover:bg-red-100 disabled:opacity-50"
        @click="deleteProject"
      >
        {{ canDelete ? 'Delete project' : 'Cannot delete the last project' }}
      </button>
    </section>
  </main>
</template>
