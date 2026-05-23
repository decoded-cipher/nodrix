<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { api, ApiError } from '../api';
import { confirm } from '../lib/confirm';
import Dropdown from './Dropdown.vue';
import type { ProjectMember, ProjectRole } from '../types';

const props = defineProps<{ project: { id: string; name: string } }>();
const emit = defineEmits<{ close: [] }>();

const roleOptions: { value: ProjectRole; label: string }[] = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'admin', label: 'Admin' },
];

const members = ref<ProjectMember[]>([]);
const loading = ref(true);
const addForm = ref<{ email: string; role: ProjectRole }>({ email: '', role: 'viewer' });
const adding = ref(false);
const addError = ref<string | null>(null);

onMounted(load);

async function load() {
  loading.value = true;
  try {
    const data = await api.get<{ members: ProjectMember[] }>(`/v1/admin/projects/${props.project.id}/members`);
    members.value = data.members;
  } catch {
    members.value = [];
  } finally {
    loading.value = false;
  }
}

async function add() {
  addError.value = null;
  adding.value = true;
  try {
    await api.post(`/v1/admin/projects/${props.project.id}/members`, {
      email: addForm.value.email.trim(),
      role: addForm.value.role,
    });
    addForm.value.email = '';
    await load();
  } catch (e) {
    addError.value =
      e instanceof ApiError && e.status === 404
        ? "No account with that email yet. Invite them from the Users page — you can pre-assign this project there."
        : (e as Error).message;
  } finally {
    adding.value = false;
  }
}

async function changeRole(userId: string, role: ProjectRole) {
  try {
    await api.patch(`/v1/admin/projects/${props.project.id}/members/${userId}`, { role });
    members.value = members.value.map((m) => (m.user_id === userId ? { ...m, role } : m));
  } catch (e) {
    alert((e as Error).message);
  }
}

async function remove(userId: string, email: string) {
  const ok = await confirm({
    title: `Remove ${email} from "${props.project.name}"?`,
    message: 'They lose access to this project immediately.',
    confirmLabel: 'Remove',
  });
  if (!ok) return;
  try {
    await api.del<void>(`/v1/admin/projects/${props.project.id}/members/${userId}`);
    members.value = members.value.filter((m) => m.user_id !== userId);
  } catch (e) {
    alert((e as Error).message);
  }
}

function nameOf(m: ProjectMember): string {
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email;
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4 dark:bg-black/70"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-lg rounded-xl bg-white shadow-xl dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800">
      <header class="flex items-center justify-between border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
        <div>
          <div class="text-sm font-semibold">Share “{{ project.name }}”</div>
          <div class="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            Admins manage everything; viewers can see dashboards and live data only.
          </div>
        </div>
        <button
          type="button"
          class="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:text-neutral-400 dark:hover:bg-neutral-800"
          aria-label="Close"
          @click="emit('close')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <div class="space-y-4 px-5 py-4">
        <!-- Add people -->
        <form class="flex flex-wrap items-end gap-2" @submit.prevent="add">
          <label class="block min-w-[180px] flex-1">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Add by email</span>
            <input
              v-model="addForm.email"
              type="email"
              required
              placeholder="teammate@example.com"
              class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>
          <Dropdown v-model="addForm.role" :options="roleOptions" size="sm" class="w-28" />
          <button
            type="submit"
            :disabled="adding"
            class="rounded-md bg-accent-600 px-3 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
          >{{ adding ? '...' : 'Add' }}</button>
        </form>
        <p v-if="addError" class="text-xs text-red-600 dark:text-red-400">{{ addError }}</p>

        <!-- People with access -->
        <div class="rounded-md border border-neutral-200 dark:border-neutral-800">
          <div v-if="loading" class="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">Loading…</div>
          <ul v-else class="divide-y divide-neutral-100 dark:divide-neutral-800">
            <li v-for="m in members" :key="m.user_id" class="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div class="min-w-0">
                <div class="truncate font-medium">{{ nameOf(m) }}</div>
                <div class="truncate text-xs text-neutral-500 dark:text-neutral-400">{{ m.email }}</div>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <Dropdown
                  :model-value="m.role"
                  :options="roleOptions"
                  size="sm"
                  class="w-28"
                  @update:model-value="(v) => changeRole(m.user_id, v as ProjectRole)"
                />
                <button
                  type="button"
                  class="rounded-md border border-red-300 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                  @click="remove(m.user_id, m.email)"
                >Remove</button>
              </div>
            </li>
            <li v-if="members.length === 0" class="px-4 py-6 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No one's been added yet. Instance owner/admins always have access.
            </li>
          </ul>
        </div>

        <div class="flex justify-end">
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            @click="emit('close')"
          >Done</button>
        </div>
      </div>
    </div>
  </div>
</template>
