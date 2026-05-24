<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSessionStore, type ActiveSession } from '../../stores/session';
import { confirm } from '../../lib/confirm';
import { toast } from '../../lib/toast';
import { relativeTime } from '../../lib/time';
import Dropdown from '../../components/Dropdown.vue';
import type { InstanceUser, InviteCreated } from '../../types';

const session = useSessionStore();

const isOwner = computed(() => session.user?.role === 'owner');
const isAdmin = computed(() => session.user?.role === 'owner' || session.user?.role === 'admin');

// Dropdown option lists.
const instanceRoleOptions: { value: 'admin' | 'member'; label: string }[] = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
];
const inviteRoleOptions = computed<{ value: 'admin' | 'member'; label: string }[]>(() =>
  isOwner.value ? instanceRoleOptions : [{ value: 'member', label: 'Member' }]
);
const inviteModeOptions: { value: 'link' | 'direct'; label: string }[] = [
  { value: 'link', label: 'Share a link' },
  { value: 'direct', label: 'Create with temp password' },
];

onMounted(async () => {
  if (!session.user) await session.load();
  try { await session.loadSessions(); } catch { /* ignore */ }
  if (isAdmin.value) {
    try { await session.loadUsers(); } catch { /* ignore */ }
  }
});

// Avatar initials from a user's name/email (used in the People list).
function initialsOf(email: string, first?: string | null, last?: string | null): string {
  const f = (first ?? '').trim();
  const l = (last ?? '').trim();
  if (f && l) return (f.charAt(0) + l.charAt(0)).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  return (email.split('@')[0] ?? '').slice(0, 2).toUpperCase();
}

// ─── Active sessions ──────────────────────────────────────────────────────────

// Condense a raw User-Agent to "Browser on OS" + a device class for the icon.
function parseAgent(ua: string | null): { label: string; device: 'desktop' | 'mobile' | 'tablet' } {
  if (!ua) return { label: 'Unknown device', device: 'desktop' };
  const browser =
    /\bEdg\//.test(ua) ? 'Edge' :
    /\bOPR\/|\bOpera/.test(ua) ? 'Opera' :
    /\bSamsungBrowser\//.test(ua) ? 'Samsung Internet' :
    /\bFirefox\//.test(ua) ? 'Firefox' :
    /\bChrome\//.test(ua) ? 'Chrome' :
    /\bSafari\//.test(ua) ? 'Safari' :
    'Browser';
  const os =
    /iPhone|iPad|iPod/.test(ua) ? 'iOS' :
    /Android/.test(ua) ? 'Android' :
    /Windows NT/.test(ua) ? 'Windows' :
    /Mac OS X|Macintosh/.test(ua) ? 'macOS' :
    /CrOS/.test(ua) ? 'ChromeOS' :
    /Linux/.test(ua) ? 'Linux' :
    '';
  const device: 'desktop' | 'mobile' | 'tablet' =
    /iPad|Tablet/.test(ua) ? 'tablet' :
    /Mobile|iPhone|Android/.test(ua) ? 'mobile' :
    'desktop';
  return { label: os ? `${browser} on ${os}` : browser, device };
}

const sessionRows = computed(() =>
  session.activeSessions.map((s) => {
    const a = parseAgent(s.user_agent);
    return { ...s, agentLabel: a.label, device: a.device };
  })
);

async function revokeDevice(s: ActiveSession) {
  const a = parseAgent(s.user_agent);
  const ok = await confirm({
    title: 'Sign out this device?',
    message: 'That session is signed out immediately and will need to log in again.',
    details: [a.label, s.ip_address ? `IP: ${s.ip_address}` : ''].filter(Boolean) as string[],
    confirmLabel: 'Sign out device',
  });
  if (!ok) return;
  try { await session.revokeSession(s.id); } catch (e) { toast.error((e as Error).message); }
}

// ─── People (owner/admin) ─────────────────────────────────────────────────────

// You can manage a row when it isn't yourself or the owner, AND you're the owner
// (any role) or you're an admin acting on a plain member.
function canManage(u: InstanceUser): boolean {
  return u.id !== session.user?.id && u.role !== 'owner' && (isOwner.value || u.role === 'member');
}

// ─── Edit user modal (role + project access) ──────────────────────────────────
const editUser = ref<InstanceUser | null>(null);
const editRole = ref<'admin' | 'member'>('member');
const editProjects = ref<Set<string>>(new Set());
const savingEdit = ref(false);

function openEdit(u: InstanceUser) {
  editUser.value = u;
  editRole.value = u.role === 'admin' ? 'admin' : 'member';
  editProjects.value = new Set(u.projects.map((p) => p.id));
}

function toggleEditProject(id: string) {
  const next = new Set(editProjects.value);
  next.has(id) ? next.delete(id) : next.add(id);
  editProjects.value = next;
}

async function saveEdit() {
  const u = editUser.value;
  if (!u) return;
  savingEdit.value = true;
  try {
    // Role change is owner-only; only call when it actually changed.
    if (isOwner.value && editRole.value !== u.role) {
      await session.setUserRole(u.id, editRole.value);
    }
    // Members carry explicit project access; admins reach everything.
    if (editRole.value === 'member') {
      await session.setUserProjects(u.id, [...editProjects.value]);
    }
    editUser.value = null;
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    savingEdit.value = false;
  }
}

async function transferOwnership(u: InstanceUser) {
  const ok = await confirm({
    title: `Transfer ownership to ${u.email}?`,
    message: 'They become the owner; you are demoted to admin. Only the owner can manage sign-in providers, updates, and the audit log.',
    confirmLabel: 'Transfer ownership',
  });
  if (!ok) return;
  try {
    await session.transferOwnership(u.id);
    editUser.value = null;
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function removeUser(u: InstanceUser) {
  const ok = await confirm({
    title: `Delete ${u.email}?`,
    message: 'They will be signed out everywhere and lose access immediately. This cannot be undone.',
    confirmLabel: 'Delete user',
  });
  if (!ok) return;
  try { await session.removeUser(u.id); } catch (e) { toast.error((e as Error).message); }
}

// ─── Invites (owner/admin) ────────────────────────────────────────────────────

const inviteOpen = ref(false);
const invite = ref<{
  email: string;
  instance_role: 'admin' | 'member';
  mode: 'link' | 'direct';
}>({ email: '', instance_role: 'member', mode: 'link' });
const inviteSubmitting = ref(false);
const inviteResult = ref<InviteCreated | null>(null);

function openInvite() {
  invite.value = { email: '', instance_role: 'member', mode: 'link' };
  inviteResult.value = null;
  inviteOpen.value = true;
}

async function submitInvite() {
  inviteSubmitting.value = true;
  try {
    inviteResult.value = await session.createInvite({
      email: invite.value.email.trim(),
      instance_role: invite.value.instance_role,
      mode: invite.value.mode,
    });
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    inviteSubmitting.value = false;
  }
}

const copied = ref(false);
async function copy(text: string) {
  try { await navigator.clipboard.writeText(text); copied.value = true; setTimeout(() => (copied.value = false), 1500); } catch { /* ignore */ }
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
              <div class="flex items-center gap-2">
                <span class="truncate font-medium">{{ [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email }}</span>
                <span v-if="u.id === session.user?.id" class="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">You</span>
              </div>
              <div class="truncate text-xs text-neutral-500 dark:text-neutral-400">{{ u.email }}</div>
              <!-- Members are scoped to specific projects; owner/admin reach all. -->
              <div v-if="u.role === 'member'" class="mt-1 flex flex-wrap items-center gap-1">
                <span
                  v-for="p in u.projects"
                  :key="p.id"
                  class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >{{ p.name }}</span>
                <span v-if="u.projects.length === 0" class="text-[11px] italic text-neutral-400 dark:text-neutral-500">No projects assigned</span>
              </div>
              <div v-else-if="u.role !== 'owner'" class="mt-1 text-[11px] text-neutral-400 dark:text-neutral-500">All projects</div>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide"
              :class="u.role === 'owner'
                ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/40 dark:text-accent-300'
                : 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'"
            >{{ u.role }}</span>

            <button
              v-if="canManage(u)"
              type="button"
              class="rounded-md border border-neutral-300 px-2.5 py-1 text-[11px] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="openEdit(u)"
            >Edit</button>
            <button
              v-if="canManage(u)"
              type="button"
              class="rounded-md border border-red-300 px-2.5 py-1 text-[11px] text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
              @click="removeUser(u)"
            >Delete</button>
          </div>
        </li>
      </ul>
    </section>

    <!-- Active sessions -->
    <section class="mt-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <span class="text-sm font-semibold">Active sessions</span>
        <span class="text-xs text-neutral-500 dark:text-neutral-400">
          {{ sessionRows.length }} {{ sessionRows.length === 1 ? 'device' : 'devices' }}
        </span>
      </div>
      <ul class="divide-y divide-neutral-100 dark:divide-neutral-800">
        <li v-for="s in sessionRows" :key="s.id" class="flex items-center gap-3 px-4 py-3">
          <!-- Device icon -->
          <div
            class="grid h-9 w-9 shrink-0 place-items-center rounded-md"
            :class="s.current ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300' : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'"
          >
            <svg v-if="s.device === 'mobile'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-[18px] w-[18px]">
              <rect x="7" y="3" width="10" height="18" rx="2" /><path d="M11 18h2" />
            </svg>
            <svg v-else-if="s.device === 'tablet'" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-[18px] w-[18px]">
              <rect x="4" y="3" width="16" height="18" rx="2" /><path d="M11 18h2" />
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" class="h-[18px] w-[18px]">
              <rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" />
            </svg>
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="truncate text-sm font-medium">{{ s.agentLabel }}</span>
              <span v-if="s.current" class="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">This device</span>
            </div>
            <div class="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              <span v-if="s.ip_address" class="font-mono">{{ s.ip_address }}</span>
              <span v-if="s.ip_address" class="text-neutral-300 dark:text-neutral-600">·</span>
              <span>active {{ relativeTime(s.last_seen_at) }}</span>
            </div>
          </div>

          <button
            v-if="!s.current"
            type="button"
            class="shrink-0 rounded-md border border-neutral-300 px-3 py-1 text-xs text-neutral-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
            @click="revokeDevice(s)"
          >Sign out</button>
        </li>
        <li v-if="sessionRows.length === 0" class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">No active sessions.</li>
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
                <Dropdown v-model="invite.instance_role" :options="inviteRoleOptions" class="mt-1" />
              </label>
              <label class="block">
                <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Method</span>
                <Dropdown v-model="invite.mode" :options="inviteModeOptions" class="mt-1" />
              </label>
            </div>

            <p class="rounded-md bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
              <span v-if="invite.instance_role === 'admin'">Admins reach every project automatically.</span>
              <span v-else>After they join, assign projects from the People list.</span>
            </p>

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

    <!-- Edit user modal (role + project access) -->
    <div v-if="editUser" class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="editUser = null">
      <div class="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
        <div class="flex items-center gap-3">
          <div class="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-neutral-100 text-[11px] font-semibold text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {{ initialsOf(editUser.email, editUser.first_name, editUser.last_name) }}
          </div>
          <div class="min-w-0">
            <div class="truncate font-semibold">{{ [editUser.first_name, editUser.last_name].filter(Boolean).join(' ') || editUser.email }}</div>
            <div class="truncate text-xs text-neutral-500 dark:text-neutral-400">{{ editUser.email }}</div>
          </div>
        </div>

        <!-- Role (owner only) -->
        <label v-if="isOwner" class="mt-4 block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Role</span>
          <Dropdown v-model="editRole" :options="instanceRoleOptions" class="mt-1" />
        </label>

        <!-- Project access (members) -->
        <div v-if="editRole === 'member'" class="mt-4">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Project access</span>
          <div v-if="session.projects.length > 0" class="mt-1 max-h-56 space-y-1 overflow-auto rounded-md border border-neutral-200 p-2 dark:border-neutral-800">
            <label
              v-for="p in session.projects"
              :key="p.id"
              class="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <input type="checkbox" :checked="editProjects.has(p.id)" @change="toggleEditProject(p.id)" />
              <span class="truncate">{{ p.name }}</span>
            </label>
          </div>
          <p v-else class="mt-1 text-sm text-neutral-500 dark:text-neutral-400">No projects exist yet.</p>
        </div>
        <p v-else class="mt-4 rounded-md bg-neutral-50 px-3 py-2 text-[11px] text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">
          Admins reach every project automatically.
        </p>

        <!-- Transfer ownership (owner only, target admin) -->
        <div v-if="isOwner && editUser.role === 'admin'" class="mt-4 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-900/50 dark:bg-amber-900/20">
          <div class="text-xs font-medium text-amber-900 dark:text-amber-300">Transfer ownership</div>
          <p class="mt-0.5 text-[11px] text-amber-800 dark:text-amber-300/80">Make this person the owner. You'll be demoted to admin.</p>
          <button
            type="button"
            class="mt-2 rounded-md border border-amber-300 bg-white px-3 py-1.5 text-[11px] text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-neutral-900 dark:text-amber-300 dark:hover:bg-amber-950/40"
            @click="transferOwnership(editUser)"
          >Make owner</button>
        </div>

        <div class="mt-5 flex justify-end gap-2">
          <button type="button" class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800" @click="editUser = null">Cancel</button>
          <button type="button" :disabled="savingEdit" class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50" @click="saveEdit">{{ savingEdit ? 'Saving…' : 'Save' }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
