<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { useUiStore } from '../stores/ui';
import { confirm } from '../lib/confirm';
import type { Project } from '../types';

const session = useSessionStore();
const ui = useUiStore();
const router = useRouter();

const newName = ref('');
const creating = ref(false);
const err = ref<string | null>(null);

// Per-card menu state.
const openMenuFor = ref<string | null>(null);

// Edit modal state.
const editing = ref<Project | null>(null);
const form = ref({ name: '', description: '', icon: '', color: '' });
const saving = ref(false);
const saveError = ref<string | null>(null);

const COLOR_SWATCHES = ['#f97316', '#ef4444', '#10b981', '#0ea5e9', '#6366f1', '#a855f7', '#64748b'];

const canDelete = computed(() => session.projects.length > 1);

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

function toggleMenu(id: string, event: Event) {
  event.stopPropagation();
  openMenuFor.value = openMenuFor.value === id ? null : id;
}

function startEdit(p: Project, event: Event) {
  event.stopPropagation();
  openMenuFor.value = null;
  editing.value = p;
  form.value = {
    name: p.name ?? '',
    description: p.description ?? '',
    icon: p.icon ?? '',
    color: p.color ?? '',
  };
  saveError.value = null;
}

function closeModal() {
  editing.value = null;
}

async function save() {
  if (!editing.value) return;
  saving.value = true;
  saveError.value = null;
  try {
    await session.updateProject(editing.value.id, {
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
      icon: form.value.icon.trim() || null,
      color: form.value.color.trim() || null,
    });
    editing.value = null;
  } catch (e) {
    saveError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

async function deleteFromModal() {
  if (!editing.value) return;
  const p = editing.value;
  if (!canDelete.value) return;
  const ok = await confirm({
    title: `Delete project "${p.name}"?`,
    message: 'This permanently removes everything in this project. It cannot be undone.',
    details: [
      'All dashboards in this project',
      'All devices and their telemetry history',
      'All API tokens scoped to this project',
    ],
    confirmLabel: 'Delete project',
  });
  if (!ok) return;
  await session.deleteProject(p.id);
  if (ui.currentProject?.id === p.id && session.projects[0]) {
    ui.setCurrentProject(session.projects[0].id);
  }
  editing.value = null;
}

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString();
}

// Close any open menu on outside click / Esc.
function handleDocClick() { openMenuFor.value = null; }
function handleKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    openMenuFor.value = null;
    if (editing.value) closeModal();
  }
}
onMounted(() => {
  document.addEventListener('click', handleDocClick);
  document.addEventListener('keydown', handleKey);
});
onUnmounted(() => {
  document.removeEventListener('click', handleDocClick);
  document.removeEventListener('keydown', handleKey);
});

// Reset edit form when the project changes (e.g. external delete).
watch(
  () => session.projects.find((p) => p.id === editing.value?.id),
  (still) => {
    if (editing.value && !still) editing.value = null;
  }
);
</script>

<template>
  <div class="mx-auto max-w-5xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Projects</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        A project is an isolated workspace for devices, dashboards, and automations.
      </p>
    </header>

    <form
      class="mb-6 flex gap-2 rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-800 dark:bg-neutral-900"
      @submit.prevent="create"
    >
      <input
        v-model="newName"
        type="text"
        placeholder="New project name (e.g. Home, Greenhouse, Office)"
        class="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-orange-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <button
        type="submit"
        :disabled="creating"
        class="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
      >
        Create project
      </button>
    </form>
    <p v-if="err" class="mb-4 text-sm text-red-600 dark:text-red-400">{{ err }}</p>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="p in session.projects"
        :key="p.id"
        class="group relative rounded-lg border border-neutral-200 bg-white p-4 text-left transition hover:border-orange-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-orange-700"
      >
        <button
          type="button"
          class="w-full text-left"
          @click="open(p.id)"
        >
          <div class="flex items-center justify-between">
            <div
              class="grid h-9 w-9 place-items-center rounded-md text-sm font-semibold"
              :style="p.color ? { backgroundColor: p.color + '20', color: p.color } : {}"
              :class="p.color ? '' : 'bg-orange-50 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300'"
            >
              <span v-if="p.icon">{{ p.icon }}</span>
              <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-[18px] w-[18px]">
                <path d="M3.75 9.75h16.5M3.75 9.75A1.5 1.5 0 0 1 5.25 8.25h3.879a1.5 1.5 0 0 1 1.06.44l1.122 1.121a1.5 1.5 0 0 0 1.06.44h6.379a1.5 1.5 0 0 1 1.5 1.5v6.75a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V9.75Z" />
              </svg>
            </div>
            <span
              v-if="ui.currentProject?.id === p.id"
              class="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
            >Current</span>
          </div>
          <div class="mt-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{{ p.name }}</div>
          <div v-if="p.description" class="mt-1 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400">{{ p.description }}</div>
          <div class="mt-1 font-mono text-[11px] text-neutral-400 dark:text-neutral-500">{{ p.id }}</div>
          <div class="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Created {{ fmt(p.created_at) }}</div>
        </button>

        <!-- Kebab menu -->
        <div class="absolute right-2 top-2">
          <button
            type="button"
            class="rounded-md p-1 text-neutral-400 opacity-0 transition group-hover:opacity-100 hover:bg-neutral-100 hover:text-neutral-700 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            :class="{ 'opacity-100 bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200': openMenuFor === p.id }"
            aria-label="Project options"
            @click="toggleMenu(p.id, $event)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4">
              <circle cx="12" cy="5"  r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="12" cy="19" r="1.6" />
            </svg>
          </button>

          <div
            v-if="openMenuFor === p.id"
            class="absolute right-0 z-10 mt-1 w-36 rounded-md border border-neutral-200 bg-white py-1 shadow-md dark:border-neutral-800 dark:bg-neutral-900"
            @click.stop
          >
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
              @click="startEdit(p, $event)"
            >Edit project</button>
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-xs text-orange-700 hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/20"
              @click="open(p.id); openMenuFor = null"
            >Open</button>
          </div>
        </div>
      </div>
    </div>

    <!-- Edit modal -->
    <div
      v-if="editing"
      class="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4 dark:bg-black/70"
      @click.self="closeModal"
    >
      <div class="w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800">
        <header class="flex items-center justify-between border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
          <div>
            <div class="text-sm font-semibold">Edit project</div>
            <div class="mt-0.5 font-mono text-[11px] text-neutral-400 dark:text-neutral-500">{{ editing.id }}</div>
          </div>
          <button
            type="button"
            class="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
            aria-label="Close"
            @click="closeModal"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </header>

        <form class="space-y-3 px-5 py-4" @submit.prevent="save">
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Name</span>
            <input
              v-model="form.name"
              type="text"
              required
              class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>

          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Description</span>
            <textarea
              v-model="form.description"
              rows="2"
              class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              placeholder="What this project is for"
            />
          </label>

          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Icon</span>
              <input
                v-model="form.icon"
                type="text"
                maxlength="4"
                class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                placeholder="🏠 or HQ"
              />
            </label>
            <div>
              <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Color</span>
              <div class="mt-1 flex flex-wrap items-center gap-2">
                <button
                  v-for="c in COLOR_SWATCHES"
                  :key="c"
                  type="button"
                  class="h-6 w-6 rounded-full ring-2 ring-offset-2 ring-offset-white dark:ring-offset-neutral-900"
                  :style="{ backgroundColor: c }"
                  :class="form.color === c ? 'ring-neutral-900 dark:ring-neutral-100' : 'ring-transparent'"
                  @click="form.color = c"
                />
                <button
                  v-if="form.color"
                  type="button"
                  class="text-xs text-neutral-500 hover:underline dark:text-neutral-400"
                  @click="form.color = ''"
                >Clear</button>
              </div>
            </div>
          </div>

          <p v-if="saveError" class="text-xs text-red-600 dark:text-red-400">{{ saveError }}</p>

          <div class="-mx-5 mt-2 border-t border-neutral-100 dark:border-neutral-800"></div>

          <div class="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/30">
            <div class="text-xs font-medium text-red-900 dark:text-red-300">Danger zone</div>
            <p class="mt-1 text-[11px] text-red-800 dark:text-red-300/80">
              Deletes all dashboards, devices, telemetry history, and API tokens scoped to
              this project. Cannot be undone.
            </p>
            <button
              type="button"
              :disabled="!canDelete"
              class="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-100 disabled:opacity-50 dark:border-red-900 dark:bg-neutral-900 dark:text-red-300 dark:hover:bg-red-950/50"
              @click="deleteFromModal"
            >{{ canDelete ? 'Delete project' : 'Cannot delete the last project' }}</button>
          </div>

          <div class="flex justify-end gap-2 pt-2">
            <button
              type="button"
              class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="closeModal"
            >Cancel</button>
            <button
              type="submit"
              :disabled="saving || !form.name.trim()"
              class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
            >{{ saving ? 'Saving…' : 'Save changes' }}</button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
