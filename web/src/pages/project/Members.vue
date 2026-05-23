<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { useSessionStore } from '../../stores/session';
import { useProjectStore } from '../../stores/project';
import { confirm } from '../../lib/confirm';
import Dropdown from '../../components/Dropdown.vue';
import type { ProjectRole } from '../../types';

const roleOptions: { value: ProjectRole; label: string }[] = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'admin', label: 'Admin' },
];

const route = useRoute();
const session = useSessionStore();
const project = useProjectStore();

const projId = computed(() => String(route.params['proj'] ?? ''));
const role = computed(() => session.projects.find((p) => p.id === projId.value)?.role ?? null);
const isAdmin = computed(() => role.value === 'admin');

const loaded = ref(false);
const addForm = ref<{ email: string; role: ProjectRole }>({ email: '', role: 'viewer' });
const adding = ref(false);
const addError = ref<string | null>(null);

onMounted(async () => {
  if (!session.user) await session.load();
  await project.switchTo(projId.value);
  if (isAdmin.value) {
    try { await project.loadMembers(); } catch { /* ignore */ }
  }
  loaded.value = true;
});

async function add() {
  addError.value = null;
  adding.value = true;
  try {
    await project.addMember(addForm.value.email.trim(), addForm.value.role);
    addForm.value.email = '';
  } catch (e) {
    const msg = (e as Error).message;
    addError.value = msg.includes('404')
      ? 'No account with that email yet. Invite them from the Users page (you can pre-assign this project there).'
      : msg;
  } finally {
    adding.value = false;
  }
}

async function changeRole(userId: string, r: ProjectRole) {
  try { await project.setMemberRole(userId, r); } catch (e) { alert((e as Error).message); }
}

async function remove(userId: string, email: string) {
  const ok = await confirm({
    title: `Remove ${email} from this project?`,
    message: 'They lose access to this project immediately.',
    confirmLabel: 'Remove',
  });
  if (!ok) return;
  try { await project.removeMember(userId); } catch (e) { alert((e as Error).message); }
}

function nameOf(m: { first_name: string | null; last_name: string | null; email: string }): string {
  return [m.first_name, m.last_name].filter(Boolean).join(' ') || m.email;
}
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Members</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Who can access this project. Admins manage everything; viewers can see dashboards
        and live data but can't edit or control devices.
      </p>
    </header>

    <div v-if="loaded && !isAdmin" class="rounded-lg border border-neutral-200 bg-white p-6 text-sm text-neutral-600 dark:border-neutral-800 dark:bg-neutral-900 dark:text-neutral-400">
      Only project admins can manage members.
    </div>

    <template v-else-if="loaded">
      <section class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">Share with an existing user</div>
        <form class="flex flex-wrap items-end gap-3 px-4 py-4" @submit.prevent="add">
          <label class="block flex-1 min-w-[200px]">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Email</span>
            <input v-model="addForm.email" type="email" required class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" placeholder="teammate@example.com" />
          </label>
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Role</span>
            <Dropdown v-model="addForm.role" :options="roleOptions" class="mt-1 w-32" />
          </label>
          <button type="submit" :disabled="adding" class="rounded-md bg-accent-600 px-3 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50">{{ adding ? '...' : 'Add' }}</button>
        </form>
        <p v-if="addError" class="px-4 pb-3 text-xs text-red-600 dark:text-red-400">{{ addError }}</p>
      </section>

      <section class="mt-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">Project members</div>
        <ul class="divide-y divide-neutral-100 dark:divide-neutral-800">
          <li v-for="m in project.members" :key="m.user_id" class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
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
              <button type="button" class="rounded-md border border-red-300 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40" @click="remove(m.user_id, m.email)">Remove</button>
            </div>
          </li>
          <li v-if="project.members.length === 0" class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">
            No explicit members yet. Instance owner/admins always have access.
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>
