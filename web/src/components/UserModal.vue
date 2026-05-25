<script setup lang="ts">
import { computed, ref } from 'vue';
import { useSessionStore } from '../stores/session';
import { confirm } from '../lib/confirm';
import { toast } from '../lib/toast';
import Dropdown from './Dropdown.vue';
import type { InstanceUser, InviteCreated } from '../types';

// One modal for both flows: inviting a new user and editing an existing one.
// They share the same role + project-access body; mode toggles the few bits that
// differ (email field + invite link vs. identity header + transfer ownership).
const props = defineProps<{
  mode: 'invite' | 'edit';
  user?: InstanceUser | null; // required in edit mode
}>();
const emit = defineEmits<{ close: [] }>();

const session = useSessionStore();
const isOwner = computed(() => session.user?.role === 'owner');

// Role is owner-only: the owner sets it when inviting a new user or editing an
// existing one. Admins inviting can onboard members only (the selector is hidden
// for them, so role stays 'member').
const roleOptions: { value: 'admin' | 'member'; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
];

// Form state, seeded from the user in edit mode.
const email = ref(props.user?.email ?? '');
const role = ref<'admin' | 'member'>(props.user?.role === 'admin' ? 'admin' : 'member');
const projectIds = ref<Set<string>>(new Set(props.user?.projects.map((p) => p.id) ?? []));
const submitting = ref(false);
const inviteResult = ref<InviteCreated | null>(null);

const title = computed(() => (props.mode === 'invite' ? 'Invite a user' : 'Edit user'));
const displayName = computed(() =>
  props.user ? [props.user.first_name, props.user.last_name].filter(Boolean).join(' ') || props.user.email : ''
);
const initials = computed(() => {
  const u = props.user;
  if (!u) return '?';
  const f = (u.first_name ?? '').trim();
  const l = (u.last_name ?? '').trim();
  if (f && l) return (f[0]! + l[0]!).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  return (u.email.split('@')[0] ?? '').slice(0, 2).toUpperCase();
});

function toggleProject(id: string) {
  const next = new Set(projectIds.value);
  next.has(id) ? next.delete(id) : next.add(id);
  projectIds.value = next;
}

async function submit() {
  submitting.value = true;
  try {
    if (props.mode === 'invite') {
      // Members get pre-assigned projects; admins reach everything, so none apply.
      inviteResult.value = await session.createInvite({
        email: email.value.trim(),
        instance_role: role.value,
        project_ids: role.value === 'member' ? [...projectIds.value] : [],
      });
      // Stay open to reveal the one-time link.
    } else if (props.user) {
      const u = props.user;
      // Role change is owner-only; only call when it actually changed.
      if (isOwner.value && role.value !== u.role) await session.setUserRole(u.id, role.value);
      if (role.value === 'member') await session.setUserProjects(u.id, [...projectIds.value]);
      emit('close');
    }
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    submitting.value = false;
  }
}

async function transferOwnership() {
  if (!props.user) return;
  const ok = await confirm({
    title: `Transfer ownership to ${props.user.email}?`,
    message: 'They become the owner; you are demoted to admin. Only the owner can manage sign-in providers, updates, and the audit log.',
    confirmLabel: 'Transfer ownership',
  });
  if (!ok) return;
  try {
    await session.transferOwnership(props.user.id);
    emit('close');
  } catch (e) {
    toast.error((e as Error).message);
  }
}

const copied = ref(false);
async function copyLink(text: string) {
  try { await navigator.clipboard.writeText(text); copied.value = true; setTimeout(() => (copied.value = false), 1500); } catch { /* ignore */ }
}
</script>

<template>
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
      <!-- Invite result: the one-time accept link. -->
      <template v-if="inviteResult">
        <h2 class="text-lg font-semibold">Invite created</h2>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          Share this link with <span class="font-medium">{{ inviteResult.email }}</span>. It won't be shown again.
        </p>
        <div class="mt-4 flex gap-2">
          <input :value="inviteResult.url" readonly class="w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950" />
          <button type="button" class="shrink-0 rounded-md border border-neutral-300 px-3 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="copyLink(inviteResult.url)">{{ copied ? 'Copied' : 'Copy' }}</button>
        </div>
        <div class="mt-5 flex justify-end">
          <button type="button" class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700" @click="emit('close')">Done</button>
        </div>
      </template>

      <!-- Invite / edit form. -->
      <form v-else class="space-y-4" @submit.prevent="submit">
        <!-- Header: editable email (invite) or identity (edit) -->
        <div v-if="mode === 'edit' && user" class="flex items-center gap-3">
          <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neutral-100 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{{ initials }}</div>
          <div class="min-w-0">
            <div class="truncate font-semibold">{{ displayName }}</div>
            <div class="truncate text-xs text-neutral-500 dark:text-neutral-400">{{ user.email }}</div>
          </div>
        </div>
        <template v-else>
          <h2 class="text-lg font-semibold">{{ title }}</h2>
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Email</span>
            <input v-model="email" type="email" required placeholder="person@example.com" class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
          </label>
        </template>

        <!-- Role: owner-only, when inviting a new user or editing an existing one. -->
        <label v-if="isOwner" class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Role</span>
          <Dropdown v-model="role" :options="roleOptions" class="mt-1" />
        </label>

        <!-- Project access. Members are scoped to specific projects (assignable
             at invite time or when editing); admins reach everything. -->
        <p v-if="role === 'admin'" class="rounded-md bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          Admins reach every project automatically.
        </p>
        <div v-else>
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Project access</span>
          <div v-if="session.projects.length > 0" class="mt-1 max-h-56 space-y-1 overflow-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
            <label
              v-for="p in session.projects"
              :key="p.id"
              class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <input type="checkbox" :checked="projectIds.has(p.id)" @change="toggleProject(p.id)" />
              <span class="truncate">{{ p.name }}</span>
            </label>
          </div>
          <p v-else class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">No projects exist yet.</p>
        </div>

        <!-- Transfer ownership (owner editing an admin). -->
        <div v-if="mode === 'edit' && isOwner && user?.role === 'admin'" class="rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
          <div class="text-xs font-medium text-amber-900 dark:text-amber-300">Transfer ownership</div>
          <p class="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300/80">Make this person the owner. You'll be demoted to admin.</p>
          <button
            type="button"
            class="mt-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-[11px] text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-neutral-900 dark:text-amber-300 dark:hover:bg-amber-950/40"
            @click="transferOwnership"
          >Make owner</button>
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <button type="button" class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="emit('close')">Cancel</button>
          <button type="submit" :disabled="submitting" class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50">
            {{ submitting ? 'Saving…' : (mode === 'invite' ? 'Create invite' : 'Save') }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
