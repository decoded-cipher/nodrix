<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';
import { RouterView, useRoute } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useProjectStore } from '../stores/project';

const route = useRoute();
const session = useSessionStore();
const project = useProjectStore();

const projId = computed(() => route.params['proj'] as string);
const current = computed(() => session.projects.find((p) => p.id === projId.value) ?? null);

onMounted(async () => {
  if (!session.user) await session.load();
  if (projId.value) await project.switchTo(projId.value);
});

watch(projId, async (id) => {
  if (id) await project.switchTo(id);
});
</script>

<template>
  <div class="flex h-full">
    <aside class="w-60 shrink-0 border-r border-neutral-200 bg-white">
      <div class="border-b border-neutral-200 px-4 py-3">
        <RouterLink to="/" class="text-xs text-neutral-500 hover:underline">&larr; All projects</RouterLink>
        <h1 class="mt-1 text-sm font-semibold">{{ current?.name ?? '...' }}</h1>
      </div>
      <nav class="p-2 text-sm">
        <RouterLink
          :to="`/p/${projId}/dashboards`"
          class="block rounded px-3 py-2 hover:bg-neutral-100"
          active-class="bg-neutral-100 font-medium"
        >Dashboards</RouterLink>
        <RouterLink
          :to="`/p/${projId}/admin/devices`"
          class="block rounded px-3 py-2 hover:bg-neutral-100"
          active-class="bg-neutral-100 font-medium"
        >Devices</RouterLink>
        <RouterLink
          :to="`/p/${projId}/admin/tokens`"
          class="block rounded px-3 py-2 hover:bg-neutral-100"
          active-class="bg-neutral-100 font-medium"
        >API tokens</RouterLink>
        <RouterLink
          :to="`/p/${projId}/admin/settings`"
          class="block rounded px-3 py-2 hover:bg-neutral-100"
          active-class="bg-neutral-100 font-medium"
        >Settings</RouterLink>
      </nav>
    </aside>
    <section class="flex-1 overflow-auto">
      <RouterView />
    </section>
  </div>
</template>
