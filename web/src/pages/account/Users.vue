<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSessionStore, type ActiveSession } from '../../stores/session';
import { confirm } from '../../lib/confirm';
import { toast } from '../../lib/toast';
import { relativeTime } from '../../lib/time';
import UserModal from '../../components/UserModal.vue';
import type { InstanceUser } from '../../types';

const session = useSessionStore();

const isOwner = computed(() => session.user?.role === 'owner');
const isAdmin = computed(() => session.user?.role === 'owner' || session.user?.role === 'admin');

onMounted(async () => {
  if (!session.user) await session.load();
  if (isAdmin.value) {
    try { await session.loadUsers(); } catch { /* ignore */ }
  }
  // Active sessions span every user — owner-only.
  if (isOwner.value) {
    try { await session.loadSessions(); } catch { /* ignore */ }
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
    const name = [s.first_name, s.last_name].filter(Boolean).join(' ') || s.user_email;
    return { ...s, agentLabel: a.label, device: a.device, userName: name };
  })
);

async function revokeDevice(s: ActiveSession) {
  const a = parseAgent(s.user_agent);
  const who = [s.first_name, s.last_name].filter(Boolean).join(' ') || s.user_email;
  const ok = await confirm({
    title: 'Sign out this device?',
    message: 'That session is signed out immediately and will need to log in again.',
    details: [who, a.label, s.ip_address ? `IP: ${s.ip_address}` : ''].filter(Boolean) as string[],
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

// ─── Add / edit modal (one shared modal for both flows) ───────────────────────
const modal = ref<{ mode: 'invite' | 'edit'; user?: InstanceUser } | null>(null);

function openInvite() { modal.value = { mode: 'invite' }; }
function openEdit(u: InstanceUser) { modal.value = { mode: 'edit', user: u }; }

async function removeUser(u: InstanceUser) {
  const ok = await confirm({
    title: `Delete ${u.email}?`,
    message: 'They will be signed out everywhere and lose access immediately. This cannot be undone.',
    confirmLabel: 'Delete user',
  });
  if (!ok) return;
  try { await session.removeUser(u.id); } catch (e) { toast.error((e as Error).message); }
}
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
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

    <!-- Active sessions (owner-only) — every user's signed-in devices. -->
    <section v-if="isOwner" class="mt-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
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
              <span class="truncate text-sm font-medium">{{ s.userName }}</span>
              <span v-if="s.user_id === session.user?.id" class="shrink-0 rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">You</span>
              <span v-if="s.current" class="shrink-0 rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">This device</span>
            </div>
            <div class="mt-0.5 flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
              <span class="truncate">{{ s.agentLabel }}</span>
              <span v-if="s.ip_address" class="hidden text-neutral-300 sm:inline dark:text-neutral-600">·</span>
              <span v-if="s.ip_address" class="hidden font-mono sm:inline">{{ s.ip_address }}</span>
              <span class="text-neutral-300 dark:text-neutral-600">·</span>
              <span class="shrink-0">active {{ relativeTime(s.last_seen_at) }}</span>
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

    <!-- Add / edit user — one shared modal for both flows. -->
    <UserModal
      v-if="modal"
      :key="modal.user?.id ?? 'invite'"
      :mode="modal.mode"
      :user="modal.user ?? null"
      @close="modal = null"
    />
  </div>
</template>
