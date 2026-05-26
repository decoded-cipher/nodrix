<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../../stores/session';
import { useThemeStore, type ThemeMode } from '../../stores/theme';
import { useAccentStore, type Accent } from '../../stores/accent';
import { api } from '../../api';
import { confirm } from '../../lib/confirm';
import { toast } from '../../lib/toast';
import Toggle from '../../components/Toggle.vue';

const session = useSessionStore();
const theme = useThemeStore();
const accent = useAccentStore();
const router = useRouter();

// ─── Your profile (name) ──────────────────────────────────────────────────────
// Read-only by default; the form opens only after clicking "Edit".
const profileForm = ref({ first_name: '', last_name: '' });
const editingProfile = ref(false);
const savingProfile = ref(false);

const fullName = computed(
  () => [session.user?.first_name, session.user?.last_name].filter(Boolean).join(' ') || null
);

// Avatar initials: first+last, else first two of the local-part of the email.
const initials = computed(() => {
  const f = (session.user?.first_name ?? '').trim();
  const l = (session.user?.last_name ?? '').trim();
  if (f && l) return (f[0]! + l[0]!).toUpperCase();
  if (f) return f.slice(0, 2).toUpperCase();
  const local = (session.user?.email ?? '').split('@')[0] ?? '';
  return local.slice(0, 2).toUpperCase() || '?';
});

// Open/close the form, seeding inputs from the stored user each time.
function editProfile(on: boolean) {
  profileForm.value.first_name = session.user?.first_name ?? '';
  profileForm.value.last_name = session.user?.last_name ?? '';
  editingProfile.value = on;
}

async function saveProfile() {
  savingProfile.value = true;
  try {
    await session.updateMe({
      first_name: profileForm.value.first_name.trim() || null,
      last_name: profileForm.value.last_name.trim() || null,
    });
    editingProfile.value = false;
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    savingProfile.value = false;
  }
}

const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
];

// Literal class strings so Tailwind's source scan generates these utilities
// (dynamic `bg-${name}` would be missed). `ring` is the selected-state outline.
const accentOptions: { value: Accent; label: string; swatch: string; ring: string }[] = [
  { value: 'orange', label: 'Orange', swatch: 'bg-orange-500', ring: 'ring-orange-500' },
  { value: 'rose', label: 'Rose', swatch: 'bg-rose-500', ring: 'ring-rose-500' },
  { value: 'amber', label: 'Amber', swatch: 'bg-amber-500', ring: 'ring-amber-500' },
  { value: 'emerald', label: 'Emerald', swatch: 'bg-emerald-500', ring: 'ring-emerald-500' },
  { value: 'teal', label: 'Teal', swatch: 'bg-teal-500', ring: 'ring-teal-500' },
  { value: 'blue', label: 'Blue', swatch: 'bg-blue-500', ring: 'ring-blue-500' },
  { value: 'indigo', label: 'Indigo', swatch: 'bg-indigo-500', ring: 'ring-indigo-500' },
  { value: 'violet', label: 'Violet', swatch: 'bg-violet-500', ring: 'ring-violet-500' },
];

type ProviderRow = {
  kind: 'google' | 'github';
  client_id: string;
  enabled: boolean;
  created_at: number;
  updated_at: number;
};

const providers = ref<ProviderRow[]>([]);
const editing = ref<'google' | 'github' | null>(null);
const form = ref({ client_id: '', client_secret: '', enabled: true });
const submitting = ref(false);

const isOwner = ref(false);

// ─── Audit log (owner-only, opt-in) ───────────────────────────────────────────
const auditLogEnabled = ref(false);
const auditLogSaving = ref(false);

async function toggleAuditLog(next: boolean) {
  // Disabling wipes every existing entry — make that explicit first.
  if (!next) {
    const ok = await confirm({
      title: 'Disable audit log?',
      message: 'Logging stops and all existing entries are permanently deleted.',
      details: ['This cannot be undone'],
      confirmLabel: 'Disable & wipe',
    });
    if (!ok) return;
  }
  auditLogSaving.value = true;
  try {
    const res = await api.put<{ audit_log_enabled: boolean }>('/v1/admin/settings/audit-log', { enabled: next });
    auditLogEnabled.value = res.audit_log_enabled;
    toast.success(res.audit_log_enabled ? 'Audit log enabled' : 'Audit log disabled — entries wiped');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    auditLogSaving.value = false;
  }
}

// ─── MCP server (owner-only, opt-in) ──────────────────────────────────────────
const mcpEnabled = ref(false);
const mcpSaving = ref(false);
const mcpUrl = computed(() => `${window.location.origin}/v1/mcp`);
const mcpOAuthUrl = computed(() => `${window.location.origin}/v1/mcp/oauth`);
const mcpConnectSnippet = computed(
  () => `claude mcp add --transport http nodrix ${mcpUrl.value} \\\n  --header "Authorization: Bearer <your token>"`
);

async function toggleMcp(next: boolean) {
  mcpSaving.value = true;
  try {
    const res = await api.put<{ mcp_enabled: boolean }>('/v1/admin/settings/mcp', { enabled: next });
    mcpEnabled.value = res.mcp_enabled;
    toast.success(res.mcp_enabled ? 'MCP server enabled' : 'MCP server disabled');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    mcpSaving.value = false;
  }
}

// Control-write sub-toggle: gates the management/control tools (incl.
// set_variable). Default off; only meaningful when MCP is on.
const mcpWriteEnabled = ref(false);
const mcpWriteSaving = ref(false);

async function toggleMcpWrite(next: boolean) {
  if (next) {
    const ok = await confirm({
      title: 'Allow MCP control writes?',
      message:
        'Admin-scope tokens will be able to create, update, run automations and set variable values — including commands sent to hardware.',
      details: ['No delete operations are ever exposed', 'Enabling the audit log is recommended'],
      confirmLabel: 'Enable writes',
    });
    if (!ok) return;
  }
  mcpWriteSaving.value = true;
  try {
    const res = await api.put<{ mcp_write_enabled: boolean }>('/v1/admin/settings/mcp-write', { enabled: next });
    mcpWriteEnabled.value = res.mcp_write_enabled;
    toast.success(res.mcp_write_enabled ? 'MCP control writes enabled' : 'MCP control writes disabled');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    mcpWriteSaving.value = false;
  }
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success('Copied to clipboard');
  } catch {
    toast.error('Copy failed');
  }
}

// Version & updates state. Polled once on mount — the worker side
// KV-caches the upstream lookup (1h) so this is cheap to re-fetch.
type VersionInfo = {
  current: { version: string; commit: string; short_commit: string; built_at: number | null };
  upstream_repo: string;
  upstream: {
    commit: { sha: string; short_sha: string; message: string; author_date: number | null; html_url: string };
    fetched_at: number;
  } | null;
  status: 'up_to_date' | 'behind' | 'unknown';
  compare_url: string | null;
  dashboard_url: string;
  script_name: string;
};
const versionInfo = ref<VersionInfo | null>(null);
const versionLoading = ref(false);

async function refreshVersion() {
  versionLoading.value = true;
  try {
    versionInfo.value = await api.get<VersionInfo>('/v1/admin/version');
  } catch {
    versionInfo.value = null;
  } finally {
    versionLoading.value = false;
  }
}

function fmtAgo(unix: number | null): string {
  if (!unix) return '';
  const diff = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtDate(unix: number | null): string {
  if (!unix) return '—';
  return new Date(unix * 1000).toLocaleString();
}

// Tracks the post-click prompt that asks the owner to hit "Retry deployment"
// over in the Cloudflare dashboard tab we just opened. Cloudflare doesn't
// expose a token-authed "trigger build" endpoint, so this is as automated
// as the flow can get — open the dashboard, then poll for the new SHA.
const updateDispatched = ref(false);

function openCloudflareDashboard() {
  if (!versionInfo.value?.dashboard_url) return;
  window.open(versionInfo.value.dashboard_url, '_blank', 'noopener,noreferrer');
  updateDispatched.value = true;
  scheduleVersionRecheck();
}

// After the owner opens the dashboard, poll /v1/admin/version every 10s
// for up to 10 min so the UI flips from "Update available" → "Up to date"
// without a manual refresh. Stops early once the deployed SHA catches up.
let versionRecheckTimer: ReturnType<typeof setTimeout> | null = null;
let versionRecheckCount = 0;
let versionRecheckStopped = false;
const VERSION_RECHECK_MAX = 60; // 60 * 10s = 10 min
function stopVersionRecheck() {
  versionRecheckStopped = true;
  if (versionRecheckTimer) {
    clearTimeout(versionRecheckTimer);
    versionRecheckTimer = null;
  }
}
function scheduleVersionRecheck() {
  versionRecheckCount = 0;
  versionRecheckStopped = false;
  if (versionRecheckTimer) clearTimeout(versionRecheckTimer);
  const tick = async () => {
    versionRecheckCount += 1;
    await refreshVersion();
    // The component may have unmounted while the request was in flight.
    if (versionRecheckStopped) return;
    if (versionInfo.value?.status === 'up_to_date') {
      updateDispatched.value = false;
      return;
    }
    if (versionRecheckCount >= VERSION_RECHECK_MAX) return;
    versionRecheckTimer = setTimeout(tick, 10_000);
  };
  versionRecheckTimer = setTimeout(tick, 10_000);
}

// Don't keep polling /v1/admin/version after the user leaves Settings.
onBeforeUnmount(stopVersionRecheck);

onMounted(async () => {
  if (session.user) isOwner.value = session.user.role === 'owner';
  if (isOwner.value) {
    try {
      const data = await api.get<{ providers: ProviderRow[] }>('/v1/admin/auth-providers');
      providers.value = data.providers;
    } catch {
      providers.value = [];
    }
    try {
      const s = await api.get<{ audit_log_enabled: boolean; mcp_enabled: boolean; mcp_write_enabled: boolean }>('/v1/admin/settings');
      auditLogEnabled.value = s.audit_log_enabled;
      mcpEnabled.value = s.mcp_enabled;
      mcpWriteEnabled.value = s.mcp_write_enabled;
    } catch { /* ignore */ }
    await refreshVersion();
  }
});

function openEdit(kind: 'google' | 'github') {
  const existing = providers.value.find((p) => p.kind === kind);
  form.value = {
    client_id: existing?.client_id ?? '',
    client_secret: '',
    enabled: existing ? existing.enabled : true,
  };
  editing.value = kind;
}

function cancel() {
  editing.value = null;
}

async function save() {
  if (!editing.value) return;
  if (!form.value.client_id.trim() || !form.value.client_secret.trim()) {
    toast.error('Both Client ID and Client Secret are required.');
    return;
  }
  submitting.value = true;
  try {
    const updated = await api.put<ProviderRow>(`/v1/admin/auth-providers/${editing.value}`, {
      client_id: form.value.client_id.trim(),
      client_secret: form.value.client_secret.trim(),
      enabled: form.value.enabled,
    });
    const i = providers.value.findIndex((p) => p.kind === editing.value);
    if (i >= 0) providers.value[i] = { ...providers.value[i]!, ...updated };
    else providers.value.push({ ...updated, created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) });
    toast.success(`${PROVIDER_META[editing.value].name} sign-in saved`);
    editing.value = null;
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    submitting.value = false;
  }
}

async function remove(kind: 'google' | 'github') {
  const label = kind === 'google' ? 'Google' : 'GitHub';
  const ok = await confirm({
    title: `Remove ${label} sign-in?`,
    message: 'The login page will stop showing the button until you configure it again.',
    details: [
      'Existing users who signed in via this provider keep their accounts',
      'They just can’t use this button to log in until it’s reconfigured',
    ],
    confirmLabel: `Remove ${label}`,
  });
  if (!ok) return;
  try {
    await api.del<void>(`/v1/admin/auth-providers/${kind}`);
    providers.value = providers.value.filter((p) => p.kind !== kind);
    toast.success(`${label} sign-in removed`);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function signOut() {
  await session.signOut();
  router.replace('/login');
}

const callbackUrl = (kind: 'google' | 'github') =>
  `${location.origin}/v1/auth/callback/${kind}`;

// Display the client ID with the middle masked. Avoids casual screen-grabs;
// Client ID isn't strictly secret, but there's no reason to show it whole.
function maskedClientId(id: string | undefined | null): string {
  if (!id) return '';
  if (id.length <= 6) return 'xxxxxxxxxx';
  return id.slice(0, 6) + 'xxxxxxxxxxxx';
}

// Brand metadata for the provider rows. Names use the providers' own casing
// (capital "G" in GitHub); the underlying `kind` stays lowercase for routing.
const PROVIDER_META = {
  google: {
    name: 'Google',
    docsUrl: 'https://console.cloud.google.com/apis/credentials',
  },
  github: {
    name: 'GitHub',
    docsUrl: 'https://github.com/settings/developers',
  },
} as const;
</script>

<template>
  <div class="mx-auto max-w-3xl px-4 py-6 sm:px-6 sm:py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Settings</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Deployment-wide configuration. For project-specific settings, edit the project
        from the <span class="font-medium">Projects</span> page.
      </p>
    </header>

    <!-- Account -->
    <section class="mb-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">Account</div>
      <div class="px-4 py-4 text-sm">
        <!-- Profile card -->
        <div class="flex items-start gap-4">
          <div class="grid h-14 w-14 shrink-0 place-items-center rounded-full bg-accent-100 text-base font-semibold text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">
            {{ initials }}
          </div>

          <!-- Read-only view -->
          <template v-if="!editingProfile">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2">
                <span
                  class="truncate text-base font-semibold"
                  :class="{ 'text-neutral-400 dark:text-neutral-500': !fullName }"
                >{{ fullName ?? 'Add your name' }}</span>
                <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
                  {{ session.user?.role ?? '' }}
                </span>
              </div>
              <div class="mt-0.5 truncate text-neutral-500 dark:text-neutral-400">{{ session.user?.email ?? '...' }}</div>
            </div>
            <div class="flex shrink-0 items-center gap-2">
              <button
                type="button"
                class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                @click="editProfile(true)"
              >Edit</button>
              <button
                type="button"
                class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs text-neutral-700 hover:border-red-300 hover:bg-red-50 hover:text-red-700 dark:border-neutral-700 dark:text-neutral-300 dark:hover:border-red-900 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                @click="signOut"
              >Sign out</button>
            </div>
          </template>

          <!-- Edit form -->
          <form v-else class="min-w-0 flex-1 space-y-3" @submit.prevent="saveProfile">
            <div class="truncate text-neutral-500 dark:text-neutral-400">{{ session.user?.email ?? '...' }}</div>
            <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label class="block">
                <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">First name</span>
                <input v-model="profileForm.first_name" type="text" maxlength="80" class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
              </label>
              <label class="block">
                <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Last name</span>
                <input v-model="profileForm.last_name" type="text" maxlength="80" class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100" />
              </label>
            </div>
            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                @click="editProfile(false)"
              >Cancel</button>
              <button
                type="submit"
                :disabled="savingProfile"
                class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
              >{{ savingProfile ? 'Saving…' : 'Save' }}</button>
            </div>
          </form>
        </div>
      </div>
    </section>

    <!-- OAuth providers (owner-only) -->
    <section v-if="isOwner" class="mb-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">Sign-in providers</div>

      <ul class="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
        <li v-for="kind in (['google', 'github'] as const)" :key="kind" class="px-4 py-3">
          <template v-if="editing !== kind">
            <div class="flex items-start justify-between gap-4">
              <div class="flex min-w-0 items-center gap-3">
                <!-- Brand logo -->
                <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-neutral-50 ring-1 ring-neutral-200 dark:bg-neutral-800 dark:ring-neutral-700">
                  <!-- Google: official 4-color "G" mark -->
                  <svg v-if="kind === 'google'" viewBox="0 0 48 48" class="h-5 w-5" aria-label="Google">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8a12 12 0 1 1 7.9-21.1l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
                    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3.1 0 6 1.2 8.1 3.1l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
                    <path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z"/>
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4 5.6l6.2 5.2A20 20 0 0 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
                  </svg>
                  <!-- GitHub: Octocat mark -->
                  <svg v-else viewBox="0 0 24 24" class="h-5 w-5 text-neutral-900 dark:text-neutral-100" fill="currentColor" aria-label="GitHub">
                    <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.6-3.9-1.6-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/>
                  </svg>
                </div>

                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium">{{ PROVIDER_META[kind].name }}</span>
                    <span
                      v-if="providers.find((p) => p.kind === kind)"
                      class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
                    >
                      {{ providers.find((p) => p.kind === kind)?.enabled ? 'Enabled' : 'Disabled' }}
                    </span>
                  </div>
                  <div
                    v-if="providers.find((p) => p.kind === kind)"
                    class="mt-0.5 truncate text-xs text-neutral-500 dark:text-neutral-400"
                  >
                    Client ID: <span class="font-mono">{{ maskedClientId(providers.find((p) => p.kind === kind)?.client_id) }}</span>
                  </div>
                  <div v-else class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Not configured</div>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  @click="openEdit(kind)"
                >{{ providers.find((p) => p.kind === kind) ? 'Edit' : 'Configure' }}</button>
                <button
                  v-if="providers.find((p) => p.kind === kind)"
                  type="button"
                  class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                  @click="remove(kind)"
                >Remove</button>
              </div>
            </div>
          </template>

          <form v-else class="space-y-3" @submit.prevent="save">
            <div class="flex items-center gap-3">
              <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-neutral-50 ring-1 ring-neutral-200 dark:bg-neutral-800 dark:ring-neutral-700">
                <svg v-if="kind === 'google'" viewBox="0 0 48 48" class="h-5 w-5" aria-label="Google">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8a12 12 0 1 1 7.9-21.1l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
                  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3.1 0 6 1.2 8.1 3.1l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
                  <path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z"/>
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4 5.6l6.2 5.2A20 20 0 0 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
                </svg>
                <svg v-else viewBox="0 0 24 24" class="h-5 w-5 text-neutral-900 dark:text-neutral-100" fill="currentColor" aria-label="GitHub">
                  <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.6-3.9-1.6-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/>
                </svg>
              </div>
              <div>
                <div class="text-sm font-medium">{{ PROVIDER_META[kind].name }} OAuth</div>
                <a
                  :href="PROVIDER_META[kind].docsUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-[11px] text-accent-700 hover:underline dark:text-accent-400"
                >Open {{ PROVIDER_META[kind].name }} OAuth console →</a>
              </div>
            </div>
            <p class="rounded-md bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
              Register a callback URL at the provider's OAuth console:
              <span class="font-mono">{{ callbackUrl(kind) }}</span>
            </p>

            <label class="block">
              <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Client ID</span>
              <input
                v-model="form.client_id"
                type="text"
                required
                class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>

            <label class="block">
              <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Client Secret</span>
              <input
                v-model="form.client_secret"
                type="password"
                required
                placeholder="Re-enter even when editing — secrets are never returned by the API"
                class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>

            <label class="flex items-center gap-2 text-sm">
              <input v-model="form.enabled" type="checkbox" />
              <span>Show this provider on the login page</span>
            </label>

            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                @click="cancel"
              >Cancel</button>
              <button
                type="submit"
                :disabled="submitting"
                class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
              >{{ submitting ? 'Saving…' : 'Save' }}</button>
            </div>
          </form>
        </li>
      </ul>
    </section>

    <!-- Appearance -->
    <section class="mb-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">Appearance</div>
      <ul class="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
        <li class="flex items-center justify-between gap-4 px-4 py-3">
          <div class="min-w-0">
            <div class="font-medium">Theme</div>
            <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              {{ theme.mode === 'system' ? `System (${theme.resolved})` : `${theme.mode[0]!.toUpperCase()}${theme.mode.slice(1)}` }}
            </div>
          </div>
          <div
            role="radiogroup"
            aria-label="Theme"
            class="inline-flex rounded-md border border-neutral-200 bg-neutral-50 p-0.5 text-xs dark:border-neutral-800 dark:bg-neutral-950"
          >
            <button
              v-for="opt in themeOptions"
              :key="opt.value"
              type="button"
              role="radio"
              :aria-checked="theme.mode === opt.value"
              class="rounded px-3 py-1 transition-colors"
              :class="theme.mode === opt.value
                ? 'bg-white text-neutral-900 shadow-sm dark:bg-neutral-800 dark:text-neutral-100'
                : 'text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'"
              @click="theme.setMode(opt.value)"
            >{{ opt.label }}</button>
          </div>
        </li>
        <li class="flex items-center justify-between gap-4 px-4 py-3">
          <div class="min-w-0">
            <div class="font-medium">Accent color</div>
            <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400 capitalize">{{ accent.accent }}</div>
          </div>
          <div role="radiogroup" aria-label="Accent color" class="flex flex-wrap items-center justify-end gap-2">
            <button
              v-for="opt in accentOptions"
              :key="opt.value"
              type="button"
              role="radio"
              :aria-checked="accent.accent === opt.value"
              :aria-label="opt.label"
              :title="opt.label"
              class="h-6 w-6 rounded-full ring-offset-2 ring-offset-white transition dark:ring-offset-neutral-900"
              :class="[opt.swatch, accent.accent === opt.value ? `ring-2 ${opt.ring}` : 'hover:scale-110']"
              @click="accent.setAccent(opt.value)"
            />
          </div>
        </li>
      </ul>
    </section>

    <!-- Version & updates (owner-only) -->
    <section v-if="isOwner" class="mb-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div class="text-sm font-semibold">Version &amp; updates</div>
        <span
          v-if="versionInfo?.status === 'behind'"
          class="rounded-full bg-accent-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-700 dark:bg-accent-900/40 dark:text-accent-300"
        >Update available</span>
        <span
          v-else-if="versionInfo?.status === 'up_to_date'"
          class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
        >Up to date</span>
      </div>

      <div class="space-y-3 px-4 py-4 text-sm">
        <!-- Current build -->
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Current</div>
            <div class="mt-0.5 font-mono text-sm">
              v{{ versionInfo?.current.version ?? '…' }}
              <span class="ml-1 text-xs text-neutral-500 dark:text-neutral-400">
                {{ versionInfo?.current.short_commit ?? '' }}
              </span>
            </div>
            <div v-if="versionInfo?.current.built_at" class="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
              Built {{ fmtDate(versionInfo.current.built_at) }}
            </div>
          </div>

          <!-- Upstream -->
          <div class="sm:text-right">
            <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Upstream</div>
            <div v-if="versionInfo?.upstream" class="mt-0.5">
              <a
                :href="versionInfo.upstream.commit.html_url"
                target="_blank"
                rel="noreferrer"
                class="font-mono text-sm text-accent-700 hover:underline dark:text-accent-400"
              >{{ versionInfo.upstream.commit.short_sha }} ↗</a>
              <div class="mt-0.5 max-w-full truncate text-[11px] text-neutral-500 sm:max-w-[260px] dark:text-neutral-400" :title="versionInfo.upstream.commit.message">
                {{ versionInfo.upstream.commit.message }}
              </div>
              <div class="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
                {{ fmtAgo(versionInfo.upstream.commit.author_date) }} · checked {{ fmtAgo(versionInfo.upstream.fetched_at) }}
              </div>
            </div>
            <div v-else-if="versionLoading" class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Checking…</div>
            <div v-else class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Couldn't reach GitHub</div>
          </div>
        </div>

        <!-- Update dispatched: owner clicked the button, we opened the
             Cloudflare dashboard for them; now waiting for the deployed
             SHA to catch up. -->
        <div
          v-if="updateDispatched"
          class="rounded-md border border-accent-200 bg-accent-50 p-3 text-xs dark:border-accent-900/60 dark:bg-accent-900/20"
        >
          <div class="flex items-center gap-2 font-semibold text-accent-900 dark:text-accent-300">
            <svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none" />
            </svg>
            <span>Cloudflare dashboard opened in a new tab</span>
          </div>
          <ol class="mt-2 list-decimal space-y-1 pl-4 text-accent-900/90 dark:text-accent-300/80">
            <li>In the Cloudflare tab: click <span class="font-medium">Retry deployment</span> on the latest build (or <span class="font-medium">Trigger Deploy</span> if no recent build is shown).</li>
            <li>Wait ~1 minute for the build to finish.</li>
            <li>This page auto-refreshes when the new version goes live.</li>
          </ol>
          <button
            type="button"
            class="mt-2 text-[11px] text-accent-700 underline hover:text-accent-900 dark:text-accent-400 dark:hover:text-accent-300"
            @click="openCloudflareDashboard"
          >Reopen Cloudflare dashboard</button>
        </div>

        <!-- Behind upstream → Update button -->
        <div
          v-else-if="versionInfo?.status === 'behind'"
          class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-accent-200 bg-accent-50 p-3 text-xs dark:border-accent-900/60 dark:bg-accent-900/20"
        >
          <div class="min-w-0 text-accent-900 dark:text-accent-300">
            <span class="font-semibold">Update available.</span>
            <span v-if="versionInfo.compare_url">
              <a :href="versionInfo.compare_url" target="_blank" rel="noreferrer" class="underline">See what changed</a>,
            </span>
            then open Cloudflare and click <span class="font-medium">Retry deployment</span>.
          </div>
          <button
            type="button"
            class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700"
            @click="openCloudflareDashboard"
          >Update now ↗</button>
        </div>

        <!-- Up to date → quiet confirmation -->
        <div
          v-else-if="versionInfo?.status === 'up_to_date'"
          class="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/30"
        >
          <div class="font-semibold text-emerald-900 dark:text-emerald-300">You're on the latest version</div>
        </div>

        <div class="border-t border-neutral-100 pt-3 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400">
          Tracking upstream <span class="font-mono">{{ versionInfo?.upstream_repo ?? '…' }}</span>
        </div>
      </div>
    </section>

    <!-- MCP server (owner-only) -->
    <section v-if="isOwner" class="mb-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center justify-between gap-4 border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div class="min-w-0">
          <div class="text-sm font-semibold">MCP server</div>
          <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            Let AI clients (Claude, IDEs) read your projects over the Model Context
            Protocol, authenticated with an API token. Off by default.
          </div>
        </div>
        <Toggle
          :model-value="mcpEnabled"
          :disabled="mcpSaving"
          label="MCP server"
          class="shrink-0"
          @update:model-value="toggleMcp"
        />
      </div>
      <div v-if="mcpEnabled" class="space-y-3 px-4 py-3 text-sm">
        <div>
          <div class="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">Endpoint</div>
          <div class="flex items-center gap-2">
            <code class="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1.5 text-xs dark:bg-neutral-800">{{ mcpUrl }}</code>
            <button
              class="shrink-0 rounded border border-neutral-200 px-2 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="copyText(mcpUrl)"
            >Copy</button>
          </div>
        </div>
        <div>
          <div class="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">Connect (Claude Code)</div>
          <div class="flex items-start gap-2">
            <pre class="min-w-0 flex-1 overflow-x-auto rounded bg-neutral-100 px-2 py-1.5 text-xs dark:bg-neutral-800"><code>{{ mcpConnectSnippet }}</code></pre>
            <button
              class="shrink-0 rounded border border-neutral-200 px-2 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="copyText(mcpConnectSnippet)"
            >Copy</button>
          </div>
          <div class="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            Create a read-scoped token in
            <router-link :to="{ name: 'tokens' }" class="underline">Tokens</router-link>
            and paste it in place of <code>&lt;your token&gt;</code>.
          </div>
        </div>

        <!-- OAuth connector URL (claude.ai web) -->
        <div>
          <div class="mb-1 text-xs font-medium text-neutral-500 dark:text-neutral-400">Connect (claude.ai — OAuth)</div>
          <div class="flex items-center gap-2">
            <code class="min-w-0 flex-1 truncate rounded bg-neutral-100 px-2 py-1.5 text-xs dark:bg-neutral-800">{{ mcpOAuthUrl }}</code>
            <button
              class="shrink-0 rounded border border-neutral-200 px-2 py-1.5 text-xs hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="copyText(mcpOAuthUrl)"
            >Copy</button>
          </div>
          <div class="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
            Add as a custom connector in claude.ai — you'll sign in here and approve access. No token needed.
          </div>
        </div>

        <!-- Control-write sub-toggle -->
        <div class="flex items-start justify-between gap-4 border-t border-neutral-100 pt-3 dark:border-neutral-800">
          <div class="min-w-0">
            <div class="font-medium">Allow control writes</div>
            <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              Let admin-scope tokens create, update, run automations, and set variable
              values (including hardware commands). Read tools stay available regardless.
              No delete operations are ever exposed.
            </div>
            <div
              v-if="mcpWriteEnabled && !auditLogEnabled"
              class="mt-1.5 rounded bg-amber-50 px-2 py-1 text-xs text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
            >
              Tip: enable the Audit log below to record MCP-driven changes.
            </div>
          </div>
          <Toggle
            :model-value="mcpWriteEnabled"
            :disabled="mcpWriteSaving"
            label="Allow control writes"
            class="shrink-0"
            @update:model-value="toggleMcpWrite"
          />
        </div>
      </div>
    </section>

    <!-- More (owner-only) -->
    <section v-if="isOwner" class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">More</div>
      <ul class="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
        <li class="flex items-center justify-between gap-4 px-4 py-3">
          <div class="min-w-0">
            <div class="font-medium">Audit log</div>
            <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
              Record every action — by users and the system — to the Audit log page. Off by
              default. Disabling permanently deletes all recorded entries.
            </div>
          </div>
          <Toggle
            :model-value="auditLogEnabled"
            :disabled="auditLogSaving"
            label="Audit log"
            class="shrink-0"
            @update:model-value="toggleAuditLog"
          />
        </li>
        <li class="flex items-center justify-between px-4 py-3">
          <div>
            <div class="font-medium">Telemetry retention &amp; export</div>
            <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Coming soon.</div>
          </div>
          <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">Soon</span>
        </li>
      </ul>
    </section>
  </div>
</template>
