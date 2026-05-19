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

// Custom domain state. The worker auto-detects the canonical on first non-
// *.workers.dev request, so most owners never touch the manual controls.
// The advanced override exists for the rare "multiple custom domains, pick
// which is canonical" case.
type CustomDomainState = {
  canonical: string | null;
  manual: boolean;
  detected_at: number | null;
};
const customDomain = ref<CustomDomainState>({ canonical: null, manual: false, detected_at: null });
const customDomainLoading = ref(false);
const showAdvanced = ref(false);
const overrideForm = ref('');
const overrideError = ref<string | null>(null);
const overrideSaving = ref(false);

const currentHost = computed(() => location.host);
const onWorkersDev = computed(() => currentHost.value.endsWith('.workers.dev'));
const onCanonical = computed(() =>
  !!customDomain.value.canonical && currentHost.value === customDomain.value.canonical
);

async function refreshCustomDomain() {
  customDomainLoading.value = true;
  try {
    customDomain.value = await api.get<CustomDomainState>('/v1/admin/custom-domain');
  } catch {
    // Endpoint is owner-only; non-owners and pre-bootstrap deploys 4xx — that's fine.
    customDomain.value = { canonical: null, manual: false, detected_at: null };
  } finally {
    customDomainLoading.value = false;
  }
}

function originUrl(host: string): string { return `https://${host}/`; }

function callbackUrlFor(kind: 'google' | 'github'): string {
  const host = customDomain.value.canonical ?? currentHost.value;
  return `https://${host}/v1/auth/callback/${kind}`;
}

const copyState = ref<Record<string, boolean>>({});
async function copyValue(key: string, value: string) {
  try {
    await navigator.clipboard.writeText(value);
    copyState.value = { ...copyState.value, [key]: true };
    setTimeout(() => { copyState.value = { ...copyState.value, [key]: false }; }, 1200);
  } catch { /* clipboard API can fail in insecure contexts */ }
}

function openOverride() {
  overrideForm.value = customDomain.value.canonical ?? '';
  overrideError.value = null;
  showAdvanced.value = true;
}

async function saveOverride() {
  const next = overrideForm.value.trim().toLowerCase();
  if (!next) {
    overrideError.value = 'Enter a hostname.';
    return;
  }
  overrideSaving.value = true;
  overrideError.value = null;
  try {
    const updated = await api.put<{ canonical: string; manual: boolean }>(
      '/v1/admin/custom-domain',
      { hostname: next }
    );
    customDomain.value = { ...customDomain.value, ...updated, detected_at: Math.floor(Date.now() / 1000) };
    showAdvanced.value = false;
  } catch (e) {
    overrideError.value = (e as Error).message;
  } finally {
    overrideSaving.value = false;
  }
}

async function clearCustomDomain() {
  const ok = await confirm({
    title: 'Clear the custom domain?',
    message: 'Requests to the workers.dev URL will stop redirecting. Use this if you detached the custom domain in Cloudflare.',
    details: [
      'The workers.dev URL becomes live again',
      'Auto-detection will run on the next hit to a custom hostname',
      'OAuth state cookies from the canonical host are unaffected',
    ],
    confirmLabel: 'Clear custom domain',
  });
  if (!ok) return;
  await api.del<void>('/v1/admin/custom-domain');
  customDomain.value = { canonical: null, manual: false, detected_at: null };
  showAdvanced.value = false;
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
    await refreshCustomDomain();
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

    <!-- Custom domain (owner-only) -->
    <section v-if="isOwner" class="mb-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">Custom domain</div>

      <div class="space-y-4 px-4 py-4 text-sm">
        <!-- Status row -->
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Currently serving at</div>
            <div class="mt-0.5 truncate font-mono text-sm">{{ currentHost }}</div>
          </div>
          <div class="min-w-0 text-right">
            <div class="text-xs uppercase tracking-wide text-neutral-500 dark:text-neutral-400">Canonical</div>
            <div v-if="customDomain.canonical" class="mt-0.5 flex items-center justify-end gap-2 truncate font-mono text-sm">
              <a
                :href="originUrl(customDomain.canonical)"
                target="_blank"
                rel="noreferrer"
                class="truncate text-orange-700 hover:underline dark:text-orange-400"
              >{{ customDomain.canonical }}</a>
              <span class="rounded-full bg-emerald-50 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Active</span>
            </div>
            <div v-else class="mt-0.5 text-sm text-neutral-500 dark:text-neutral-400">Not configured</div>
          </div>
        </div>

        <!-- State 1: no canonical detected yet — show setup instructions -->
        <div
          v-if="!customDomain.canonical && !customDomainLoading"
          class="rounded-md border border-neutral-200 bg-neutral-50 p-3 dark:border-neutral-800 dark:bg-neutral-950"
        >
          <div class="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
            Attach a custom domain via Cloudflare
          </div>
          <ol class="mt-2 space-y-1.5 pl-4 text-xs leading-relaxed text-neutral-600 list-decimal dark:text-neutral-400">
            <li>Open this Worker in the Cloudflare dashboard.</li>
            <li>Go to <span class="font-medium">Settings → Triggers → Custom Domains</span>.</li>
            <li>Click <span class="font-medium">Add Custom Domain</span>, enter your hostname (e.g. <span class="font-mono">iot.theircompany.com</span>), save.</li>
            <li>Visit your new hostname once — nodrix detects it automatically and starts redirecting <span class="font-mono">{{ currentHost }}</span> here.</li>
          </ol>
          <div class="mt-3 flex flex-wrap gap-2">
            <a
              href="https://dash.cloudflare.com/?to=/:account/workers/services"
              target="_blank"
              rel="noreferrer"
              class="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
            >Open Cloudflare dashboard ↗</a>
            <a
              href="https://developers.cloudflare.com/workers/configuration/routing/custom-domains/"
              target="_blank"
              rel="noreferrer"
              class="rounded-md border border-neutral-300 bg-white px-3 py-1 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
            >Read the docs ↗</a>
          </div>
          <p class="mt-2 text-[11px] text-neutral-500 dark:text-neutral-400">
            Requirement: the domain's zone must be in the same Cloudflare account as this Worker.
            Domains hosted in a different CF account or at another DNS provider (Namecheap, GoDaddy, etc.)
            aren't supported yet — coming in a future release.
          </p>
        </div>

        <!-- State 2: canonical set, but viewing via workers.dev (e.g. opened settings on the old URL) -->
        <div
          v-else-if="customDomain.canonical && onWorkersDev"
          class="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs dark:border-amber-900/60 dark:bg-amber-900/20"
        >
          <div class="font-semibold text-amber-900 dark:text-amber-300">You're viewing the legacy URL</div>
          <p class="mt-1 text-amber-800 dark:text-amber-300/80">
            This deployment now serves at
            <a :href="originUrl(customDomain.canonical)" class="underline">{{ customDomain.canonical }}</a>.
            <span class="font-mono">{{ currentHost }}</span> redirects there automatically for non-admin traffic.
          </p>
        </div>

        <!-- State 3: on the canonical, active — show OAuth + integrations reminders -->
        <div v-else-if="customDomain.canonical && onCanonical" class="space-y-3">
          <div class="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950">
            <div class="font-semibold text-neutral-700 dark:text-neutral-200">OAuth callbacks</div>
            <p class="mt-1 text-neutral-600 dark:text-neutral-400">
              Add these callback URLs at your OAuth providers so sign-in keeps working:
            </p>
            <div class="mt-2 space-y-1.5">
              <div v-for="kind in (['google', 'github'] as const)" :key="kind" class="flex items-center gap-2">
                <span class="w-16 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">{{ kind }}</span>
                <code class="flex-1 truncate rounded bg-white px-2 py-1 font-mono text-[11px] dark:bg-neutral-900">{{ callbackUrlFor(kind) }}</code>
                <button
                  type="button"
                  class="rounded border border-neutral-300 px-2 py-1 text-[11px] hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                  @click="copyValue(`cb-${kind}`, callbackUrlFor(kind))"
                >{{ copyState[`cb-${kind}`] ? 'Copied' : 'Copy' }}</button>
              </div>
            </div>
          </div>

          <div class="rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs dark:border-neutral-800 dark:bg-neutral-950">
            <div class="font-semibold text-neutral-700 dark:text-neutral-200">External integrations</div>
            <p class="mt-1 text-neutral-600 dark:text-neutral-400">
              Update any scripts, dashboards, or devices that point at the old
              <span class="font-mono">*.workers.dev</span> URL to use
              <span class="font-mono">{{ customDomain.canonical }}</span> directly.
              The old URL still works (308-redirects here), but some HTTP clients strip
              Authorization headers across redirects — bearer-token integrations may start
              returning 401.
            </p>
          </div>
        </div>

        <!-- Advanced controls -->
        <div v-if="customDomain.canonical">
          <button
            type="button"
            class="text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            @click="showAdvanced ? (showAdvanced = false) : openOverride()"
          >{{ showAdvanced ? 'Hide advanced ↑' : 'Advanced ↓' }}</button>

          <div v-if="showAdvanced" class="mt-3 space-y-3 rounded-md border border-neutral-200 p-3 dark:border-neutral-800">
            <label class="block">
              <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Override canonical hostname</span>
              <span class="mt-0.5 block text-[11px] text-neutral-500 dark:text-neutral-400">
                Pin a specific hostname so auto-detection doesn't change it. Useful when you have multiple custom domains attached.
              </span>
              <div class="mt-2 flex gap-2">
                <input
                  v-model="overrideForm"
                  type="text"
                  placeholder="iot.theircompany.com"
                  class="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-1.5 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                />
                <button
                  type="button"
                  :disabled="overrideSaving"
                  class="rounded-md bg-orange-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
                  @click="saveOverride"
                >{{ overrideSaving ? 'Saving…' : 'Save' }}</button>
              </div>
              <p v-if="overrideError" class="mt-1 text-[11px] text-red-600 dark:text-red-400">{{ overrideError }}</p>
            </label>

            <div class="border-t border-neutral-100 pt-3 dark:border-neutral-800">
              <button
                type="button"
                class="rounded-md border border-red-300 px-3 py-1.5 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
                @click="clearCustomDomain"
              >Clear canonical</button>
              <p class="mt-1 text-[11px] text-neutral-500 dark:text-neutral-400">
                Stops redirecting <span class="font-mono">*.workers.dev</span> to the custom domain. Use this if you've detached the domain in Cloudflare.
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- More -->
    <section class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">More</div>
      <ul class="divide-y divide-neutral-100 text-sm dark:divide-neutral-800">
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
