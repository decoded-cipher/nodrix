<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSessionStore } from '../../stores/session';
import { confirm } from '../../lib/confirm';
import type { InviteCreated } from '../../types';

const session = useSessionStore();

const isOwner = computed(() => session.user?.role === 'owner');
const isAdmin = computed(() => session.user?.role === 'owner' || session.user?.role === 'admin');

onMounted(async () => {
  if (!session.user) await session.load();
  try { await session.loadSessions(); } catch { /* ignore */ }
  if (isAdmin.value) {
    try { await Promise.all([session.loadUsers(), session.loadInvites()]); } catch { /* ignore */ }
  }
});

// ─── Profile (self) ───────────────────────────────────────────────────────────

const editing = ref(false);
const form = ref({ first_name: '', last_name: '' });
const saving = ref(false);
const saveError = ref<string | null>(null);

watch(
  () => session.user,
  (u) => {
    if (!u) return;
    form.value.first_name = u.first_name ?? '';
    form.value.last_name = u.last_name ?? '';
  },
  { immediate: true }
);

const displayName = computed(() => {
  const u = session.user;
  if (!u) return '';
  const parts = [u.first_name, u.last_name].filter((s): s is string => !!s && !!s.trim());
  return parts.length > 0 ? parts.join(' ') : u.email;
});

function initialsOf(email: string, first?: string | null, last?: string | null): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (f && l) return (f.charAt(0) + l.charAt(0)).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  return (email.split('@')[0] ?? '').slice(0, 2).toUpperCase();
}

const initials = computed(() =>
  session.user ? initialsOf(session.user.email, session.user.first_name, session.user.last_name) : '?'
);

function fmt(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toLocaleString() : '—';
}

function startEdit() {
  if (!session.user) return;
  form.value.first_name = session.user.first_name ?? '';
  form.value.last_name = session.user.last_name ?? '';
  saveError.value = null;
  editing.value = true;
}
function cancel() { editing.value = false; saveError.value = null; }
async function save() {
  saving.value = true;
  saveError.value = null;
  try {
    await session.updateMe({
      first_name: form.value.first_name.trim() || null,
      last_name: form.value.last_name.trim() || null,
    });
    editing.value = false;
  } catch (e) {
    saveError.value = (e as Error).message;
  } finally {
    saving.value = false;
  }
}

// ─── People (owner/admin) ─────────────────────────────────────────────────────

async function changeRole(id: string, role: 'admin' | 'member') {
  try { await session.setUserRole(id, role); } catch (e) { alert((e as Error).message); }
}

async function removeUser(id: string, email: string) {
  const ok = await confirm({
    title: `Remove ${email}?`,
    message: 'They will be signed out everywhere and lose access immediately. This cannot be undone.',
    confirmLabel: 'Remove user',
  });
  if (!ok) return;
  try { await session.removeUser(id); } catch (e) { alert((e as Error).message); }
}

async function makeOwner(id: string, email: string) {
  const ok = await confirm({
    title: `Transfer ownership to ${email}?`,
    message: 'They become the owner; you are demoted to admin. Only the owner can manage sign-in providers and updates.',
    confirmLabel: 'Transfer ownership',
  });
  if (!ok) return;
  try { await session.transferOwnership(id); } catch (e) { alert((e as Error).message); }
}

// ─── Invites (owner/admin) ────────────────────────────────────────────────────

const inviteOpen = ref(false);
const invite = ref<{
  email: string;
  instance_role: 'admin' | 'member';
  mode: 'link' | 'direct';
  projects: Record<string, 'admin' | 'viewer' | ''>;
}>({ email: '', instance_role: 'member', mode: 'link', projects: {} });
const inviteSubmitting = ref(false);
const inviteError = ref<string | null>(null);
const inviteResult = ref<InviteCreated | null>(null);

function openInvite() {
  invite.value = { email: '', instance_role: 'member', mode: 'link', projects: {} };
  inviteError.value = null;
  inviteResult.value = null;
  inviteOpen.value = true;
}

async function submitInvite() {
  inviteError.value = null;
  inviteSubmitting.value = true;
  try {
    const projects = Object.entries(invite.value.projects)
      .filter(([, role]) => role === 'admin' || role === 'viewer')
      .map(([project_id, role]) => ({ project_id, role: role as 'admin' | 'viewer' }));
    inviteResult.value = await session.createInvite({
      email: invite.value.email.trim(),
      instance_role: invite.value.instance_role,
      mode: invite.value.mode,
      projects,
    });
  } catch (e) {
    inviteError.value = (e as Error).message;
  } finally {
    inviteSubmitting.value = false;
  }
}

async function revokeInvite(id: string, email: string | null) {
  const ok = await confirm({
    title: 'Revoke this invite?',
    message: `The invite${email ? ` for ${email}` : ''} will stop working immediately.`,
    confirmLabel: 'Revoke',
  });
  if (!ok) return;
  try { await session.revokeInvite(id); } catch (e) { alert((e as Error).message); }
}

const copied = ref(false);
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); copied.value = true; setTimeout(() => (copied.value = false), 1500); } catch { /* ignore */ }
}

function inviteStatus(i: { accepted_at: number | null; revoked_at: number | null; expires_at: number | null }): string {
  if (i.accepted_at) return 'Accepted';
  if (i.revoked_at) return 'Revoked';
  if (i.expires_at && i.expires_at * 1000 < Date.now()) return 'Expired';
  return 'Pending';
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Users</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        People with access to this deployment. Sign-in uses email/password or a configured
        social provider.
      </p>
    </header>

    <!-- Profile -->
    <section class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div v-if="session.user && !editing" class="flex items-center justify-between px-4 py-4">
        <div class="flex min-w-0 items-center gap-3">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-100 text-xs font-semibold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">
            {{ initials }}
          </div>
          <div class="min-w-0">
            <div class="truncate text-sm font-medium">{{ displayName }}</div>
            <div v-if="displayName !== session.user.email" class="truncate text-xs text-neutral-500 dark:text-neutral-400">
              {{ session.user.email }}
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
              <span>{{ session.user.role }}</span>
              <span>·</span>
              <span class="normal-case tracking-normal">last login: {{ fmt(session.user.last_login_at) }}</span>
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">You</span>
          <button type="button" class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="startEdit">Edit</button>
        </div>
      </div>

      <form v-else-if="session.user" class="space-y-3 px-4 py-4" @submit.prevent="save">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">First name</span>
            <input v-model="form.first_name" type="text" maxlength="80" class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
          </label>
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Last name</span>
            <input v-model="form.last_name" type="text" maxlength="80" class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
          </label>
        </div>
        <p v-if="saveError" class="text-xs text-red-600 dark:text-red-400">{{ saveError }}</p>
        <div class="flex justify-end gap-2 pt-1">
          <button type="button" class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="cancel">Cancel</button>
          <button type="submit" :disabled="saving" class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50">{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
      </form>
    </section>

    <!-- People (owner/admin) -->
    <section v-if="isAdmin" class="mt-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div class="text-sm font-semibold">People</div>
        <button type="button" class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700" @click="openInvite">Invite user</button>
      </div>
      <ul class="divide-y divide-neutral-100 dark:divide-neutral-800">
        <li v-for="u in session.instanceUsers" :key="u.id" class="flex items-center justify-between gap-3 px-4 py-3 text-sm">
          <div class="flex min-w-0 items-center gap-3">
            <div class="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutral-100 text-[10px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              {{ initialsOf(u.email, u.first_name, u.last_name) }}
            </div>
            <div class="min-w-0">
              <div class="truncate font-medium">{{ [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email }}</div>
              <div class="truncate text-xs text-neutral-500 dark:text-neutral-400">{{ u.email }}</div>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span v-if="u.role === 'owner'" class="rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">Owner</span>
            <select
              v-else-if="isOwner && u.id !== session.user?.id"
              :value="u.role"
              class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950"
              @change="changeRole(u.id, ($event.target as HTMLSelectElement).value as 'admin' | 'member')"
            >
              <option value="admin">Admin</option>
              <option value="member">Member</option>
            </select>
            <span v-else class="text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{{ u.role }}</span>

            <button v-if="isOwner && u.role === 'admin' && u.id !== session.user?.id" type="button" class="rounded-md border border-neutral-300 px-2 py-1 text-[11px] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="makeOwner(u.id, u.email)">Make owner</button>
            <button
              v-if="u.role !== 'owner' && u.id !== session.user?.id && (isOwner || u.role === 'member')"
              type="button"
              class="rounded-md border border-red-300 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              @click="removeUser(u.id, u.email)"
            >Remove</button>
          </div>
        </li>
      </ul>
    </section>

    <!-- Invites (owner/admin) -->
    <section v-if="isAdmin" class="mt-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">Invites</div>

      <ul class="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
        <li v-for="i in session.invites" :key="i.id" class="flex items-center justify-between gap-3 px-4 py-3">
          <div class="min-w-0">
            <div class="truncate font-medium">{{ i.email ?? '(open link)' }}</div>
            <div class="text-xs text-neutral-500 dark:text-neutral-400">
              {{ i.instance_role }} · invited by {{ i.inviter_email ?? '—' }}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span class="rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide"
              :class="inviteStatus(i) === 'Pending'
                ? 'bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
                : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'">
              {{ inviteStatus(i) }}
            </span>
            <button v-if="inviteStatus(i) === 'Pending'" type="button" class="rounded-md border border-red-300 px-2 py-1 text-[11px] text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40" @click="revokeInvite(i.id, i.email)">Revoke</button>
          </div>
        </li>
        <li v-if="session.invites.length === 0" class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">No invites yet.</li>
      </ul>
    </section>

    <!-- Active sessions -->
    <section class="mt-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">Active sessions</div>
      <ul class="divide-y divide-neutral-100 dark:divide-neutral-800">
        <li v-for="s in session.activeSessions" :key="s.id" class="flex items-center justify-between px-4 py-3 text-sm">
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ s.user_agent ?? 'Unknown device' }}</span>
              <span v-if="s.current" class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">This device</span>
            </div>
            <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              <span v-if="s.ip_address" class="font-mono">{{ s.ip_address }}</span>
              <span v-if="s.ip_address"> · </span>
              <span>last seen {{ fmt(s.last_seen_at) }}</span>
            </div>
          </div>
          <button v-if="!s.current" type="button" class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40" @click="session.revokeSession(s.id)">Sign out</button>
        </li>
        <li v-if="session.activeSessions.length === 0" class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">No active sessions.</li>
      </ul>
    </section>

    <!-- Invite modal -->
    <div v-if="inviteOpen" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="inviteOpen = false">
      <div class="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <h2 class="text-lg font-semibold">Invite a user</h2>

        <template v-if="!inviteResult">
          <form class="mt-4 space-y-3" @submit.prevent="submitInvite">
            <label class="block">
              <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Email</span>
              <input v-model="invite.email" type="email" required class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" placeholder="person@example.com" />
            </label>

            <div class="grid grid-cols-2 gap-3">
              <label class="block">
                <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Instance role</span>
                <select v-model="invite.instance_role" class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950">
                  <option value="member">Member</option>
                  <option v-if="isOwner" value="admin">Admin</option>
                </select>
              </label>
              <label class="block">
                <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Method</span>
                <select v-model="invite.mode" class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950">
                  <option value="link">Share a link</option>
                  <option value="direct">Create with temp password</option>
                </select>
              </label>
            </div>

            <div v-if="session.projects.length > 0">
              <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Project access (optional)</span>
              <div class="mt-1 max-h-40 space-y-1 overflow-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
                <div v-for="p in session.projects" :key="p.id" class="flex items-center justify-between gap-2 text-sm">
                  <span class="truncate">{{ p.name }}</span>
                  <select v-model="invite.projects[p.id]" class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950">
                    <option value="">No access</option>
                    <option value="viewer">Viewer</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
              </div>
            </div>

            <p v-if="inviteError" class="text-xs text-red-600 dark:text-red-400">{{ inviteError }}</p>
            <div class="flex justify-end gap-2 pt-1">
              <button type="button" class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="inviteOpen = false">Cancel</button>
              <button type="submit" :disabled="inviteSubmitting" class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50">{{ inviteSubmitting ? '...' : 'Create invite' }}</button>
            </div>
          </form>
        </template>

        <template v-else>
          <div class="mt-4 space-y-3 text-sm">
            <p class="text-neutral-600 dark:text-neutral-400">
              Invite created for <span class="font-medium">{{ inviteResult.email }}</span>. Copy this now — it won't be shown again.
            </p>
            <div v-if="inviteResult.url" class="space-y-1">
              <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Invite link</span>
              <div class="flex gap-2">
                <input :value="inviteResult.url" readonly class="w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950" />
                <button type="button" class="shrink-0 rounded-md border border-neutral-300 px-3 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="copy(inviteResult.url!)">{{ copied ? 'Copied' : 'Copy' }}</button>
              </div>
            </div>
            <div v-if="inviteResult.temp_password" class="space-y-1">
              <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Temporary password</span>
              <div class="flex gap-2">
                <input :value="inviteResult.temp_password" readonly class="w-full rounded-md border border-neutral-300 bg-neutral-50 px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950" />
                <button type="button" class="shrink-0 rounded-md border border-neutral-300 px-3 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="copy(inviteResult.temp_password!)">{{ copied ? 'Copied' : 'Copy' }}</button>
              </div>
              <p class="text-[11px] text-neutral-500 dark:text-neutral-400">They sign in at the login page with this email + password.</p>
            </div>
            <div class="flex justify-end pt-1">
              <button type="button" class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700" @click="inviteOpen = false">Done</button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
