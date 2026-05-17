<script setup lang="ts">
import { ref } from 'vue';
import { useSessionStore } from '../stores/session';

const session = useSessionStore();
const newName = ref('');
const creating = ref(false);
const err = ref<string | null>(null);

async function create() {
  const n = newName.value.trim();
  if (!n) return;
  creating.value = true;
  err.value = null;
  try {
    await session.createProject(n);
    newName.value = '';
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    creating.value = false;
  }
}
</script>

<template>
  <main class="mx-auto max-w-3xl px-6 py-12">
    <header class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">Projects</h1>
        <p class="text-sm text-neutral-600">
          Signed in as <span class="font-mono">{{ session.user?.email }}</span>
        </p>
      </div>
    </header>

    <section class="rounded-lg border border-neutral-200 bg-white p-4">
      <ul class="divide-y divide-neutral-200">
        <li v-for="p in session.projects" :key="p.id" class="flex items-center justify-between py-3">
          <RouterLink :to="`/p/${p.id}/dashboards`" class="text-sm font-medium hover:underline">
            {{ p.name }}
          </RouterLink>
          <span class="font-mono text-xs text-neutral-500">{{ p.id }}</span>
        </li>
      </ul>

      <form class="mt-4 flex gap-2 border-t border-neutral-200 pt-4" @submit.prevent="create">
        <input
          v-model="newName"
          type="text"
          placeholder="New project name"
          class="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          :disabled="creating"
          class="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
        >
          Create
        </button>
      </form>
      <p v-if="err" class="mt-2 text-sm text-red-600">{{ err }}</p>
    </section>
  </main>
</template>
