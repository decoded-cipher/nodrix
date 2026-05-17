<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';

const session = useSessionStore();
const ui = useUiStore();
const router = useRouter();

const newName = ref('');
const creating = ref(false);
const err = ref<string | null>(null);

async function create() {
  const n = newName.value.trim();
  if (!n) return;
  creating.value = true;
  err.value = null;
  try {
    const p = await session.createProject(n);
    newName.value = '';
    ui.setCurrentProject(p.id);
    router.push(`/p/${p.id}/dashboards`);
  } catch (e) {
    err.value = (e as Error).message;
  } finally {
    creating.value = false;
  }
}

function open(id: string) {
  ui.setCurrentProject(id);
  router.push(`/p/${id}/dashboards`);
}

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString();
}
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Projects</h1>
      <p class="mt-1 text-sm text-neutral-600">
        A project is an isolated workspace for devices, dashboards, and automations.
      </p>
    </header>

    <form
      class="mb-6 flex gap-2 rounded-lg border border-neutral-200 bg-white p-3"
      @submit.prevent="create"
    >
      <input
        v-model="newName"
        type="text"
        placeholder="New project name (e.g. Home, Greenhouse, Office)"
        class="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
      />
      <button
        type="submit"
        :disabled="creating"
        class="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
      >
        Create project
      </button>
    </form>
    <p v-if="err" class="mb-4 text-sm text-red-600">{{ err }}</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <button
        v-for="p in session.projects"
        :key="p.id"
        type="button"
        class="group rounded-lg border border-neutral-200 bg-white p-4 text-left transition hover:border-orange-300 hover:shadow-sm"
        @click="open(p.id)"
      >
        <div class="flex items-center justify-between">
          <div class="grid h-9 w-9 place-items-center rounded-md bg-orange-50 text-orange-700">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-[18px] w-[18px]">
              <path d="M3.75 9.75h16.5M3.75 9.75A1.5 1.5 0 0 1 5.25 8.25h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.121a1.5 1.5 0 0 0 1.06.44h6.379a1.5 1.5 0 0 1 1.5 1.5v6.75a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V9.75Z" />
            </svg>
          </div>
          <span
            v-if="ui.currentProject?.id === p.id"
            class="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-orange-700"
          >Current</span>
        </div>
        <div class="mt-3 text-sm font-semibold text-neutral-900">{{ p.name }}</div>
        <div class="mt-1 font-mono text-[11px] text-neutral-400">{{ p.id }}</div>
        <div class="mt-3 text-xs text-neutral-500">Created {{ fmt(p.created_at) }}</div>
      </button>
    </div>
  </div>
</template>
