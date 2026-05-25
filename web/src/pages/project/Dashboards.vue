<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore } from '../../stores/project';
import { confirm } from '../../lib/confirm';
import { toast } from '../../lib/toast';
import ShareDialog from '../../components/ShareDialog.vue';
import type { DashboardMeta } from '../../types';

const project = useProjectStore();
const router = useRouter();

const newName = ref('');
const creating = ref(false);

// Per-card menu state.
const openMenuFor = ref<string | null>(null);

// Share dialog state.
const sharing = ref<DashboardMeta | null>(null);

function shareFromMenu(d: DashboardMeta, event: Event) {
  event.stopPropagation();
  openMenuFor.value = null;
  sharing.value = d;
}

// Edit modal state.
const editing = ref<DashboardMeta | null>(null);
const form = ref({ name: '', description: '' });
const saving = ref(false);

async function create() {
  const n = newName.value.trim();
  if (!n) return;
  creating.value = true;
  try {
    const d = await project.createDashboard(n);
    newName.value = '';
    router.push(`/p/${project.currentProjectId}/d/${d.id}/edit`);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    creating.value = false;
  }
}

function open(id: string) {
  router.push(`/p/${project.currentProjectId}/d/${id}`);
}

function toggleMenu(id: string, event: Event) {
  event.stopPropagation();
  openMenuFor.value = openMenuFor.value === id ? null : id;
}

function startEdit(d: DashboardMeta, event: Event) {
  event.stopPropagation();
  openMenuFor.value = null;
  editing.value = d;
  form.value = {
    name: d.name ?? '',
    description: d.description ?? '',
  };
}

function closeModal() {
  editing.value = null;
}

async function save() {
  if (!editing.value) return;
  saving.value = true;
  try {
    await project.updateDashboard(editing.value.id, {
      name: form.value.name.trim(),
      description: form.value.description.trim() || null,
    });
    editing.value = null;
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

async function removeDashboard(d: DashboardMeta) {
  const ok = await confirm({
    title: `Delete dashboard "${d.name}"?`,
    message: 'This action cannot be undone.',
    details: [
      'The layout is removed and open viewers are disconnected',
      'Telemetry from the variables it referenced is not affected',
    ],
    confirmLabel: 'Delete dashboard',
  });
  if (!ok) return;
  try {
    await project.deleteDashboard(d.id);
  } catch (e) {
    toast.error((e as Error).message);
    return;
  }
  if (editing.value?.id === d.id) editing.value = null;
}

function deleteFromMenu(d: DashboardMeta, event: Event) {
  event.stopPropagation();
  openMenuFor.value = null;
  void removeDashboard(d);
}

function deleteFromModal() {
  if (!editing.value) return;
  void removeDashboard(editing.value);
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

// Reset edit form when the dashboard disappears (e.g. external delete).
watch(
  () => project.dashboards.find((d) => d.id === editing.value?.id),
  (still) => {
    if (editing.value && !still) editing.value = null;
  }
);
</script>

<template>
  <div class="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Dashboards</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        A dashboard is a live view of your project's variables, built from widgets.
      </p>
    </header>

    <form
      class="mb-6 flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 sm:flex-row dark:border-neutral-800 dark:bg-neutral-900"
      @submit.prevent="create"
    >
      <input
        v-model="newName"
        type="text"
        placeholder="New dashboard name (e.g. Overview, Greenhouse, Floor 1)"
        class="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <button
        type="submit"
        :disabled="creating"
        class="shrink-0 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
      >
        Create dashboard
      </button>
    </form>

    <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <div
        v-for="d in project.dashboards"
        :key="d.id"
        class="group relative rounded-lg border border-neutral-200 bg-white p-4 text-left transition hover:border-accent-300 hover:shadow-sm dark:border-neutral-800 dark:bg-neutral-900 dark:hover:border-accent-700"
      >
        <button
          type="button"
          class="w-full text-left"
          @click="open(d.id)"
        >
          <div class="grid h-9 w-9 place-items-center rounded-md bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-[18px] w-[18px]">
              <rect x="3.75" y="3.75" width="6.5" height="6.5" rx="1" />
              <rect x="13.75" y="3.75" width="6.5" height="4" rx="1" />
              <rect x="13.75" y="10.25" width="6.5" height="10" rx="1" />
              <rect x="3.75" y="13.75" width="6.5" height="6.5" rx="1" />
            </svg>
          </div>
          <div class="mt-3 text-sm font-semibold text-neutral-900 dark:text-neutral-100">{{ d.name }}</div>
          <div v-if="d.description" class="mt-1 line-clamp-2 text-xs text-neutral-600 dark:text-neutral-400">{{ d.description }}</div>
          <div class="mt-1 font-mono text-[11px] text-neutral-400 dark:text-neutral-500">{{ d.id }}</div>
          <div class="mt-3 text-xs text-neutral-500 dark:text-neutral-400">Created {{ fmt(d.created_at) }}</div>
        </button>

        <!-- Kebab menu -->
        <div class="absolute right-2 top-2">
          <button
            type="button"
            class="rounded-md p-1 text-neutral-400 opacity-100 transition hover:bg-neutral-100 hover:text-neutral-700 lg:opacity-0 lg:group-hover:opacity-100 dark:text-neutral-500 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
            :class="{ 'opacity-100 bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200': openMenuFor === d.id }"
            aria-label="Dashboard options"
            @click="toggleMenu(d.id, $event)"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4">
              <circle cx="12" cy="5"  r="1.6" />
              <circle cx="12" cy="12" r="1.6" />
              <circle cx="12" cy="19" r="1.6" />
            </svg>
          </button>

          <div
            v-if="openMenuFor === d.id"
            class="absolute right-0 z-10 mt-1 w-40 rounded-md border border-neutral-200 bg-white py-1 shadow-md dark:border-neutral-800 dark:bg-neutral-900"
            @click.stop
          >
            <button
              type="button"
              class="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
              @click="shareFromMenu(d, $event)"
            >
              <span>Share</span>
              <span
                v-if="d.visibility === 'public'"
                class="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
              >Public</span>
            </button>
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
              @click="startEdit(d, $event)"
            >Edit dashboard</button>
            <button
              type="button"
              class="block w-full px-3 py-1.5 text-left text-xs text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
              @click="deleteFromMenu(d, $event)"
            >Delete dashboard</button>
          </div>
        </div>
      </div>

      <div
        v-if="project.dashboards.length === 0"
        class="col-span-full rounded-lg border border-dashed border-neutral-300 px-4 py-10 text-center text-sm text-neutral-500 dark:border-neutral-700 dark:text-neutral-400"
      >
        No dashboards yet. Create one above to get started.
      </div>
    </div>

    <!-- Edit modal -->
    <div
      v-if="editing"
      class="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4 dark:bg-black/70"
      @click.self="closeModal"
    >
      <div class="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl bg-white shadow-xl dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800">
        <header class="flex items-center justify-between border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
          <div>
            <div class="text-sm font-semibold">Edit dashboard</div>
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
              placeholder="What this dashboard shows"
            />
          </label>

          <div class="-mx-5 mt-2 border-t border-neutral-100 dark:border-neutral-800"></div>

          <div class="rounded-md border border-red-200 bg-red-50 p-3 dark:border-red-900/60 dark:bg-red-950/30">
            <div class="text-xs font-medium text-red-900 dark:text-red-300">Danger zone</div>
            <p class="mt-1 text-[11px] text-red-800 dark:text-red-300/80">
              Deletes this dashboard's layout and disconnects any open viewers. Cannot be undone.
            </p>
            <button
              type="button"
              class="mt-2 rounded-md border border-red-300 bg-white px-3 py-1.5 text-xs text-red-700 hover:bg-red-100 dark:border-red-900 dark:bg-neutral-900 dark:text-red-300 dark:hover:bg-red-950/50"
              @click="deleteFromModal"
            >Delete dashboard</button>
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
              class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
            >{{ saving ? 'Saving…' : 'Save changes' }}</button>
          </div>
        </form>
      </div>
    </div>

    <ShareDialog
      v-if="sharing"
      :dashboard="sharing"
      @close="sharing = null"
    />
  </div>
</template>
