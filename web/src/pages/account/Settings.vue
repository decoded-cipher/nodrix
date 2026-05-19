<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../../stores/session';
import { useThemeStore, type ThemeMode } from '../../stores/theme';
import { api } from '../../api';
import { confirm } from '../../lib/confirm';

const session = useSessionStore();
const theme = useThemeStore();
const router = useRouter();

const themeOptions: { value: ThemeMode; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
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
const error = ref<string | null>(null);

const isOwner = ref(false);

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

// Update flow state — configured token, in-flight build, and polling.
type UpdateConfig = {
  configured: boolean;
  account_id: string | null;
  account_name: string | null;
  script_name: string | null;
  last_build_id: string | null;
  dismissed_at: number | null;
};
type BuildStatus = {
  build_id?: string;
  status: 'idle' | 'queued' | 'running' | 'success' | 'failure' | 'unknown';
  logs_url?: string;
  error?: unknown;
};

const updateConfig = ref<UpdateConfig>({
  configured: false,
  account_id: null,
  account_name: null,
  script_name: null,
  last_build_id: null,
  dismissed_at: null,
});
const buildStatus = ref<BuildStatus>({ status: 'idle' });
const updateTriggering = ref(false);
const updateError = ref<string | null>(null);
let buildPollTimer: ReturnType<typeof setTimeout> | null = null;

async function refreshUpdateConfig() {
  try {
    updateConfig.value = await api.get<UpdateConfig>('/v1/admin/update');
  } catch {
    // Owner-only endpoint; failures are tolerated.
  }
}

async function refreshBuildStatus() {
  try {
    buildStatus.value = await api.get<BuildStatus>('/v1/admin/update/status');
  } catch {
    buildStatus.value = { status: 'unknown' };
  }
}

function isBuildInFlight(s: BuildStatus['status']): boolean {
  return s === 'queued' || s === 'running';
}

function schedulePoll() {
  if (buildPollTimer) clearTimeout(buildPollTimer);
  buildPollTimer = setTimeout(async () => {
    await refreshBuildStatus();
    if (isBuildInFlight(buildStatus.value.status)) {
      schedulePoll();
    } else if (buildStatus.value.status === 'success') {
      // New build finished → fetch the freshly-baked version info.
      await refreshVersion();
    }
  }, 5000);
}

// Tracks the post-click prompt that asks the owner to hit "Retry deployment"
// over in the Cloudflare dashboard tab we just opened.
const updateDispatched = ref(false);

async function triggerUpdate() {
  updateTriggering.value = true;
  updateError.value = null;
  try {
    const res = await api.post<{ dashboard_url: string }>('/v1/admin/update/trigger');
    // Open the dashboard's Workers Builds tab in a new tab. Cloudflare's
    // public API doesn't expose a token-authed "trigger build" endpoint yet,
    // so the owner clicks "Retry deployment" there. We start lightweight
    // polling here so we auto-detect when the new SHA lands.
    window.open(res.dashboard_url, '_blank', 'noopener,noreferrer');
    updateDispatched.value = true;
    scheduleVersionRecheck();
  } catch (e) {
    updateError.value = (e as Error).message;
  } finally {
    updateTriggering.value = false;
  }
}

// After "Update now" opens the dashboard, poll /v1/admin/version every 10s
// for up to 10 min so the UI flips from "Update available" → "Up to date"
// without the owner having to refresh manually. Stops early once we detect
// the deployed SHA caught up.
let versionRecheckTimer: ReturnType<typeof setTimeout> | null = null;
let versionRecheckCount = 0;
const VERSION_RECHECK_MAX = 60; // 60 * 10s = 10 min
function scheduleVersionRecheck() {
  versionRecheckCount = 0;
  if (versionRecheckTimer) clearTimeout(versionRecheckTimer);
  const tick = async () => {
    versionRecheckCount += 1;
    await refreshVersion();
    if (versionInfo.value?.status === 'up_to_date') {
      updateDispatched.value = false;
      return;
    }
    if (versionRecheckCount >= VERSION_RECHECK_MAX) return;
    versionRecheckTimer = setTimeout(tick, 10_000);
  };
  versionRecheckTimer = setTimeout(tick, 10_000);
}

async function disconnectUpdateToken() {
  const ok = await confirm({
    title: 'Disconnect Cloudflare API token?',
    message: 'The stored token will be deleted from this deployment’s database. Your deployment keeps running normally — only the in-app update flow stops.',
    details: [
      'The "Update now" button will disappear from this page',
      'You can re-enable updates anytime by pasting a new token',
      'No Cloudflare resources are deleted or changed',
    ],
    confirmLabel: 'Disconnect token',
    cancelLabel: 'Keep it',
  });
  if (!ok) return;
  await api.del<void>('/v1/admin/update/config');
  await refreshUpdateConfig();
}

onMounted(async () => {
  if (session.user) isOwner.value = session.user.role === 'owner';
  if (isOwner.value) {
    try {
      const data = await api.get<{ providers: ProviderRow[] }>('/v1/admin/auth-providers');
      providers.value = data.providers;
    } catch {
      providers.value = [];
    }
    await Promise.all([
      refreshVersion(),
      refreshUpdateConfig(),
      refreshBuildStatus(),
    ]);
    if (isBuildInFlight(buildStatus.value.status)) schedulePoll();
  }
});

function openEdit(kind: 'google' | 'github') {
  const existing = providers.value.find((p) => p.kind === kind);
  form.value = {
    client_id: existing?.client_id ?? '',
    client_secret: '',
    enabled: existing ? existing.enabled : true,
  };
  error.value = null;
  editing.value = kind;
}

function cancel() {
  editing.value = null;
  error.value = null;
}

async function save() {
  if (!editing.value) return;
  if (!form.value.client_id.trim() || !form.value.client_secret.trim()) {
    error.value = 'Both Client ID and Client Secret are required.';
    return;
  }
  submitting.value = true;
  error.value = null;
  try {
    const updated = await api.put<ProviderRow>(`/v1/admin/auth-providers/${editing.value}`, {
      client_id: form.value.client_id.trim(),
      client_secret: form.value.client_secret.trim(),
      enabled: form.value.enabled,
    });
    const i = providers.value.findIndex((p) => p.kind === editing.value);
    if (i >= 0) providers.value[i] = { ...providers.value[i]!, ...updated };
    else providers.value.push({ ...updated, created_at: Math.floor(Date.now() / 1000), updated_at: Math.floor(Date.now() / 1000) });
    editing.value = null;
  } catch (e) {
    error.value = (e as Error).message;
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
  await api.del<void>(`/v1/admin/auth-providers/${kind}`);
  providers.value = providers.value.filter((p) => p.kind !== kind);
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
  <div class="mx-auto max-w-3xl px-6 py-8">
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
      <div class="space-y-3 px-4 py-4 text-sm">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-neutral-500 dark:text-neutral-400">Email</div>
            <div class="font-medium">{{ session.user?.email ?? '...' }}</div>
          </div>
          <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">
            {{ session.user?.role ?? '' }}
          </span>
        </div>
        <div>
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            @click="signOut"
          >Sign out</button>
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
                  class="text-[11px] text-orange-700 hover:underline dark:text-orange-400"
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

            <p v-if="error" class="text-xs text-red-600 dark:text-red-400">{{ error }}</p>

            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                @click="cancel"
              >Cancel</button>
              <button
                type="submit"
                :disabled="submitting"
                class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
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
      </ul>
    </section>

    <!-- Version & updates (owner-only) -->
    <section v-if="isOwner" class="mb-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center justify-between border-b border-neutral-100 px-4 py-3 dark:border-neutral-800">
        <div class="text-sm font-semibold">Version &amp; updates</div>
        <span
          v-if="versionInfo?.status === 'behind'"
          class="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-orange-700 dark:bg-orange-900/40 dark:text-orange-300"
        >Update available</span>
        <span
          v-else-if="versionInfo?.status === 'up_to_date'"
          class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"
        >Up to date</span>
      </div>

      <div class="space-y-3 px-4 py-4 text-sm">
        <!-- Current build -->
        <div class="flex items-start justify-between gap-4">
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
          <div class="text-right">
            <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Upstream</div>
            <div v-if="versionInfo?.upstream" class="mt-0.5">
              <a
                :href="versionInfo.upstream.commit.html_url"
                target="_blank"
                rel="noreferrer"
                class="font-mono text-sm text-orange-700 hover:underline dark:text-orange-400"
              >{{ versionInfo.upstream.commit.short_sha }} ↗</a>
              <div class="mt-0.5 max-w-[260px] truncate text-[11px] text-neutral-500 dark:text-neutral-400" :title="versionInfo.upstream.commit.message">
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

        <!-- Behind: show 'See diff' link -->
        <div
          v-if="versionInfo?.status === 'behind' && versionInfo.compare_url"
          class="rounded-md border border-orange-200 bg-orange-50 p-3 text-xs dark:border-orange-900/60 dark:bg-orange-900/20"
        >
          <div class="font-semibold text-orange-900 dark:text-orange-300">A newer version is on upstream</div>
          <p class="mt-1 text-orange-800 dark:text-orange-300/80">
            See what changed:
            <a :href="versionInfo.compare_url" target="_blank" rel="noreferrer" class="underline">
              {{ versionInfo.current.short_commit }} … {{ versionInfo.upstream!.commit.short_sha }}
            </a>
          </p>
        </div>

        <!-- Action row: depends on whether the CF API token is configured -->

        <!-- Token NOT configured → CTA to onboarding wizard -->
        <div
          v-if="!updateConfig.configured"
          class="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div class="font-semibold text-neutral-700 dark:text-neutral-200">One-click updates aren't set up yet</div>
          <p class="mt-1 text-neutral-600 dark:text-neutral-400">
            Connect a Cloudflare API token so this deployment can redeploy itself when new versions land upstream.
            Setup takes about 2 minutes and the token stays encrypted at rest.
          </p>
          <RouterLink
            to="/onboarding"
            class="mt-2 inline-block rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700"
          >Set up one-click updates →</RouterLink>
        </div>

        <!-- Token configured + build in flight → polling state -->
        <div
          v-else-if="isBuildInFlight(buildStatus.status)"
          class="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div class="flex items-center gap-2 font-semibold text-neutral-700 dark:text-neutral-200">
            <svg class="h-3.5 w-3.5 animate-spin text-orange-600" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.2" stroke-width="3" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none" />
            </svg>
            <span>Build {{ buildStatus.status }}…</span>
          </div>
          <p class="mt-1 text-neutral-600 dark:text-neutral-400">
            Cloudflare Workers Builds is pulling the latest upstream code and redeploying.
            This page will update when the build finishes (~1–2 minutes).
          </p>
          <a
            v-if="buildStatus.logs_url"
            :href="buildStatus.logs_url"
            target="_blank"
            rel="noreferrer"
            class="mt-2 inline-block text-orange-700 hover:underline dark:text-orange-400"
          >View build logs ↗</a>
        </div>

        <!-- Token configured + last build failed -->
        <div
          v-else-if="buildStatus.status === 'failure'"
          class="rounded-md border border-red-200 bg-red-50 p-3 text-xs dark:border-red-900/60 dark:bg-red-950/30"
        >
          <div class="font-semibold text-red-900 dark:text-red-300">Last update build failed</div>
          <p class="mt-1 text-red-800 dark:text-red-300/80">
            Check the build logs for details. You can retry once you've fixed the issue.
          </p>
          <div class="mt-2 flex flex-wrap items-center gap-2">
            <a
              v-if="buildStatus.logs_url"
              :href="buildStatus.logs_url"
              target="_blank"
              rel="noreferrer"
              class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-100 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            >View logs ↗</a>
            <button
              type="button"
              :disabled="updateTriggering"
              class="rounded-md bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
              @click="triggerUpdate"
            >{{ updateTriggering ? 'Retrying…' : 'Retry build' }}</button>
          </div>
        </div>

        <!-- Token configured + update dispatched: owner clicked the button,
             we opened the Cloudflare dashboard for them; now waiting for the
             deployed SHA to catch up to upstream. -->
        <div
          v-else-if="updateDispatched"
          class="rounded-md border border-orange-200 bg-orange-50 p-3 text-xs dark:border-orange-900/60 dark:bg-orange-900/20"
        >
          <div class="flex items-center gap-2 font-semibold text-orange-900 dark:text-orange-300">
            <svg class="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-opacity="0.25" stroke-width="3" />
              <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" stroke-width="3" stroke-linecap="round" fill="none" />
            </svg>
            <span>Cloudflare dashboard opened in a new tab</span>
          </div>
          <ol class="mt-2 list-decimal space-y-1 pl-4 text-orange-900/90 dark:text-orange-300/80">
            <li>In the Cloudflare tab: click <span class="font-medium">Retry deployment</span> on the latest build (or <span class="font-medium">Trigger Deploy</span> if no recent build is shown).</li>
            <li>Wait ~1 minute for the build to finish.</li>
            <li>This page auto-refreshes when the new version goes live.</li>
          </ol>
          <button
            type="button"
            class="mt-2 text-[11px] text-orange-700 underline hover:text-orange-900 dark:text-orange-400 dark:hover:text-orange-300"
            @click="triggerUpdate"
          >Reopen Cloudflare dashboard</button>
        </div>

        <!-- Token configured + behind upstream → real Update button -->
        <div
          v-else-if="versionInfo?.status === 'behind'"
          class="flex flex-wrap items-center justify-between gap-3 rounded-md border border-orange-200 bg-orange-50 p-3 text-xs dark:border-orange-900/60 dark:bg-orange-900/20"
        >
          <div class="min-w-0 text-orange-900 dark:text-orange-300">
            <span class="font-semibold">Update available.</span>
            Opens the Cloudflare Builds page where you click <span class="font-medium">Retry deployment</span> to pull the latest upstream code.
          </div>
          <button
            type="button"
            :disabled="updateTriggering"
            class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
            @click="triggerUpdate"
          >{{ updateTriggering ? 'Opening…' : 'Update now ↗' }}</button>
        </div>

        <!-- Token configured + up to date → quiet confirmation -->
        <div
          v-else-if="versionInfo?.status === 'up_to_date'"
          class="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-xs dark:border-emerald-900/60 dark:bg-emerald-950/30"
        >
          <div class="font-semibold text-emerald-900 dark:text-emerald-300">You're on the latest version</div>
          <p class="mt-1 text-emerald-800 dark:text-emerald-300/80">
            One-click updates are wired up — you'll see a button here when new versions land upstream.
          </p>
        </div>

        <p v-if="updateError" class="text-xs text-red-600 dark:text-red-400">{{ updateError }}</p>

        <!-- Configured-state footer with tracking info + disconnect action -->
        <div
          v-if="updateConfig.configured"
          class="flex flex-wrap items-center justify-between gap-3 border-t border-neutral-100 pt-3 text-[11px] text-neutral-500 dark:border-neutral-800 dark:text-neutral-400"
        >
          <div>
            Tracking upstream <span class="font-mono">{{ versionInfo?.upstream_repo ?? '…' }}</span>
            ·
            Account
            <span class="font-mono">{{ updateConfig.account_name ?? updateConfig.account_id }}</span>
          </div>
          <button
            type="button"
            class="inline-flex items-center gap-1.5 rounded-md border border-red-300 px-2.5 py-1 text-[11px] font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            @click="disconnectUpdateToken"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-3 w-3">
              <path d="M18.36 6.64a9 9 0 1 1-12.73 0M12 2v10" />
            </svg>
            Disconnect token
          </button>
        </div>
      </div>
    </section>

    <!-- More -->
    <section class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">More</div>
      <ul class="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
        <li class="flex items-center justify-between px-4 py-3">
          <div>
            <div class="font-medium">Custom domain</div>
            <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Bring your own domain or subdomain — managed via Cloudflare, Namecheap, GoDaddy and others.</div>
          </div>
          <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">Soon</span>
        </li>
        <li class="flex items-center justify-between px-4 py-3">
          <div>
            <div class="font-medium">Branding</div>
            <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">Logo, favicon, and accent color for white-labeled deployments.</div>
          </div>
          <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">Soon</span>
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
