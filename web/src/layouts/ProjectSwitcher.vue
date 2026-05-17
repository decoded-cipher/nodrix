<script setup lang="ts">
import { computed, ref, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';

const session = useSessionStore();
const ui = useUiStore();
const router = useRouter();

const open = ref(false);
const rootEl = ref<HTMLElement | null>(null);

const current = computed(() => ui.currentProject);
const others = computed(() => session.projects.filter((p) => p.id !== current.value?.id));

function pick(id: string): void {
  ui.setCurrentProject(id);
  open.value = false;
  router.push(`/p/${id}/dashboards`);
}

function onDocClick(e: MouseEvent): void {
  if (!rootEl.value) return;
  if (!rootEl.value.contains(e.target as Node)) open.value = false;
}

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));
</script>

<template>
  <div ref="rootEl" class="relative">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 rounded-md border border-neutral-200 bg-white px-3 py-2 text-left text-sm hover:bg-neutral-50"
      @click="open = !open"
    >
      <div class="min-w-0">
        <div class="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Project</div>
        <div class="truncate text-sm font-medium">
          {{ current?.name ?? 'No project' }}
        </div>
      </div>
      <svg
        xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"
        stroke-width="2" stroke="currentColor" class="h-4 w-4 shrink-0 text-neutral-500"
      >
        <path stroke-linecap="round" stroke-linejoin="round" d="m7 10 5 5 5-5" />
      </svg>
    </button>

    <div
      v-if="open"
      class="absolute left-0 right-0 z-20 mt-1 rounded-md border border-neutral-200 bg-white py-1 shadow-lg"
    >
      <ul class="max-h-56 overflow-y-auto text-sm">
        <li v-for="p in others" :key="p.id">
          <button
            type="button"
            class="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-neutral-50"
            @click="pick(p.id)"
          >
            <span class="truncate">{{ p.name }}</span>
            <span class="ml-2 font-mono text-[10px] text-neutral-400">{{ p.id.slice(0, 6) }}</span>
          </button>
        </li>
        <li v-if="others.length === 0" class="px-3 py-2 text-xs text-neutral-500">
          No other projects
        </li>
      </ul>
      <div class="border-t border-neutral-100">
        <RouterLink
          to="/projects"
          class="block px-3 py-2 text-xs text-orange-700 hover:bg-orange-50"
          @click="open = false"
        >Manage projects →</RouterLink>
      </div>
    </div>
  </div>
</template>
