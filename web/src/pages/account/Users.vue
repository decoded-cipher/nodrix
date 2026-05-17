<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { useSessionStore } from '../../stores/session';
import { confirm } from '../../lib/confirm';

const session = useSessionStore();

onMounted(async () => {
  if (!session.user) await session.load();
  try { await session.loadSessions(); } catch { /* ignore */ }
});

function fmtAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  // Crude UA → friendly summary. Good enough for the device list.
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /Chrome\//.test(ua) && !/Edg\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua) && !/Chrome\//.test(ua) ? 'Safari' :
    'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows' :
    /Mac OS X/.test(ua) ? 'macOS' :
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad/.test(ua) ? 'iOS' :
    /Linux/.test(ua) ? 'Linux' :
    '';
  return os ? `${browser} on ${os}` : browser;
}

async function revoke(id: string) {
  const s = session.activeSessions.find((x) => x.id === id);
  const ok = await confirm({
    title: 'Sign out this device?',
    message: 'Whoever is using this session will be signed out immediately and need to log in again.',
    details: [
      `Device: ${fmtAgent(s?.user_agent ?? null)}`,
      s?.ip_address ? `IP: ${s.ip_address}` : 'IP: unknown',
      s?.last_seen_at ? `Last seen: ${fmt(s.last_seen_at)}` : '',
    ].filter(Boolean) as string[],
    confirmLabel: 'Sign out device',
  });
  if (!ok) return;
  await session.revokeSession(id);
}

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

const initials = computed(() => {
  const u = session.user;
  if (!u) return '?';
  const f = (u.first_name ?? '').trim();
  const l = (u.last_name ?? '').trim();
  if (f && l) return (f.charAt(0) + l.charAt(0)).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  const local = u.email.split('@')[0] ?? '';
  return local.slice(0, 2).toUpperCase();
});

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

function cancel() {
  editing.value = false;
  saveError.value = null;
}

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
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Users</h1>
      <p class="mt-1 text-sm text-neutral-600">
        People with access to this deployment. Sign-in is handled by Cloudflare Access — invite
        users by adding them to your Access policy.
      </p>
    </header>

    <section class="rounded-lg border border-neutral-200 bg-white">
      <!-- Display row -->
      <div v-if="session.user && !editing" class="flex items-center justify-between px-4 py-4">
        <div class="flex min-w-0 items-center gap-3">
          <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-orange-100 text-xs font-semibold text-orange-700">
            {{ initials }}
          </div>

          <div class="min-w-0">
            <div class="truncate text-sm font-medium">{{ displayName }}</div>
            <div v-if="displayName !== session.user.email" class="truncate text-xs text-neutral-500">
              {{ session.user.email }}
            </div>
            <div class="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wide text-neutral-500">
              <span>{{ session.user.role }}</span>
              <span>·</span>
              <span class="normal-case tracking-normal">last login: {{ fmt(session.user.last_login_at) }}</span>
            </div>
          </div>
        </div>
        <div class="flex shrink-0 items-center gap-2">
          <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">You</span>
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100"
            @click="startEdit"
          >Edit</button>
        </div>
      </div>

      <!-- Edit form -->
      <form v-else-if="session.user" class="space-y-3 px-4 py-4" @submit.prevent="save">
        <div class="flex items-center gap-3">
          <div class="grid h-10 w-10 place-items-center rounded-full bg-orange-100 text-xs font-semibold text-orange-700">
            {{ initials }}
          </div>
          <div class="min-w-0">
            <div class="text-xs text-neutral-500">{{ session.user.email }}</div>
            <div class="mt-0.5 text-[11px] uppercase tracking-wide text-neutral-500">
              {{ session.user.role }}
            </div>
          </div>
        </div>

        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600">First name</span>
            <input
              v-model="form.first_name"
              type="text"
              maxlength="80"
              class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              placeholder="First"
            />
          </label>
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600">Last name</span>
            <input
              v-model="form.last_name"
              type="text"
              maxlength="80"
              class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
              placeholder="Last"
            />
          </label>
        </div>

        <p v-if="saveError" class="text-xs text-red-600">{{ saveError }}</p>

        <div class="flex justify-end gap-2 pt-1">
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
            @click="cancel"
          >Cancel</button>
          <button
            type="submit"
            :disabled="saving"
            class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
          >{{ saving ? 'Saving…' : 'Save' }}</button>
        </div>
      </form>
    </section>

    <!-- Active sessions -->
    <section class="mt-6 rounded-lg border border-neutral-200 bg-white">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold">Active sessions</div>
      <ul class="divide-y divide-neutral-100">
        <li
          v-for="s in session.activeSessions"
          :key="s.id"
          class="flex items-center justify-between px-4 py-3 text-sm"
        >
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-2">
              <span class="font-medium">{{ fmtAgent(s.user_agent) }}</span>
              <span
                v-if="s.current"
                class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700"
              >This device</span>
            </div>
            <div class="mt-0.5 text-xs text-neutral-500">
              <span v-if="s.ip_address" class="font-mono">{{ s.ip_address }}</span>
              <span v-if="s.ip_address"> · </span>
              <span>last seen {{ fmt(s.last_seen_at) }}</span>
            </div>
          </div>
          <button
            v-if="!s.current"
            type="button"
            class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
            @click="revoke(s.id)"
          >Sign out</button>
        </li>
        <li v-if="session.activeSessions.length === 0" class="px-4 py-6 text-sm text-neutral-500">
          No active sessions.
        </li>
      </ul>
    </section>

    <section class="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-6">
      <h3 class="text-sm font-semibold">Multi-user management is on the roadmap</h3>
      <p class="mt-2 text-xs text-neutral-600">
        For now, the owner is the only account. Per-user roles, per-project access, and
        invitations land in a future release.
      </p>
    </section>
  </div>
</template>
