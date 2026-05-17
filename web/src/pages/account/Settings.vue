<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../../stores/session';
import { api } from '../../api';
import { confirm } from '../../lib/confirm';

const session = useSessionStore();
const router = useRouter();

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

onMounted(async () => {
  if (session.user) isOwner.value = session.user.role === 'owner';
  if (isOwner.value) {
    try {
      const data = await api.get<{ providers: ProviderRow[] }>('/v1/admin/auth-providers');
      providers.value = data.providers;
    } catch {
      providers.value = [];
    }
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
      <p class="mt-1 text-sm text-neutral-600">
        Deployment-wide configuration. For project-specific settings, edit the project
        from the <span class="font-medium">Projects</span> page.
      </p>
    </header>

    <!-- Account -->
    <section class="mb-6 rounded-lg border border-neutral-200 bg-white">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold">Account</div>
      <div class="space-y-3 px-4 py-4 text-sm">
        <div class="flex items-center justify-between">
          <div>
            <div class="text-neutral-500">Email</div>
            <div class="font-medium">{{ session.user?.email ?? '...' }}</div>
          </div>
          <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-600">
            {{ session.user?.role ?? '' }}
          </span>
        </div>
        <div>
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
            @click="signOut"
          >Sign out</button>
        </div>
      </div>
    </section>

    <!-- OAuth providers (owner-only) -->
    <section v-if="isOwner" class="mb-6 rounded-lg border border-neutral-200 bg-white">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold">Sign-in providers</div>

      <ul class="divide-y divide-neutral-100 text-sm">
        <li v-for="kind in (['google', 'github'] as const)" :key="kind" class="px-4 py-3">
          <template v-if="editing !== kind">
            <div class="flex items-start justify-between gap-4">
              <div class="flex min-w-0 items-center gap-3">
                <!-- Brand logo -->
                <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-neutral-50 ring-1 ring-neutral-200">
                  <!-- Google: official 4-color "G" mark -->
                  <svg v-if="kind === 'google'" viewBox="0 0 48 48" class="h-5 w-5" aria-label="Google">
                    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8a12 12 0 1 1 7.9-21.1l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
                    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3.1 0 6 1.2 8.1 3.1l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
                    <path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z"/>
                    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4 5.6l6.2 5.2A20 20 0 0 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
                  </svg>
                  <!-- GitHub: Octocat mark -->
                  <svg v-else viewBox="0 0 24 24" class="h-5 w-5 text-neutral-900" fill="currentColor" aria-label="GitHub">
                    <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.6-3.9-1.6-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/>
                  </svg>
                </div>

                <div class="min-w-0">
                  <div class="flex items-center gap-2">
                    <span class="text-sm font-medium">{{ PROVIDER_META[kind].name }}</span>
                    <span
                      v-if="providers.find((p) => p.kind === kind)"
                      class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] uppercase tracking-wide text-emerald-700"
                    >
                      {{ providers.find((p) => p.kind === kind)?.enabled ? 'Enabled' : 'Disabled' }}
                    </span>
                  </div>
                  <div
                    v-if="providers.find((p) => p.kind === kind)"
                    class="mt-0.5 truncate text-xs text-neutral-500"
                  >
                    Client ID: <span class="font-mono">{{ providers.find((p) => p.kind === kind)?.client_id }}</span>
                  </div>
                  <div v-else class="mt-0.5 text-xs text-neutral-500">Not configured</div>
                </div>
              </div>

              <div class="flex shrink-0 items-center gap-2">
                <button
                  type="button"
                  class="rounded-md border border-neutral-300 px-3 py-1 text-xs hover:bg-neutral-100"
                  @click="openEdit(kind)"
                >{{ providers.find((p) => p.kind === kind) ? 'Edit' : 'Configure' }}</button>
                <button
                  v-if="providers.find((p) => p.kind === kind)"
                  type="button"
                  class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                  @click="remove(kind)"
                >Remove</button>
              </div>
            </div>
          </template>

          <form v-else class="space-y-3" @submit.prevent="save">
            <div class="flex items-center gap-3">
              <div class="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-neutral-50 ring-1 ring-neutral-200">
                <svg v-if="kind === 'google'" viewBox="0 0 48 48" class="h-5 w-5" aria-label="Google">
                  <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8a12 12 0 1 1 7.9-21.1l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
                  <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3.1 0 6 1.2 8.1 3.1l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
                  <path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z"/>
                  <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4 5.6l6.2 5.2A20 20 0 0 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
                </svg>
                <svg v-else viewBox="0 0 24 24" class="h-5 w-5 text-neutral-900" fill="currentColor" aria-label="GitHub">
                  <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.6-3.9-1.6-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/>
                </svg>
              </div>
              <div>
                <div class="text-sm font-medium">{{ PROVIDER_META[kind].name }} OAuth</div>
                <a
                  :href="PROVIDER_META[kind].docsUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="text-[11px] text-orange-700 hover:underline"
                >Open {{ PROVIDER_META[kind].name }} OAuth console →</a>
              </div>
            </div>
            <p class="rounded-md bg-neutral-50 px-3 py-2 text-[11px] text-neutral-600">
              Register a callback URL at the provider's OAuth console:
              <span class="font-mono">{{ callbackUrl(kind) }}</span>
            </p>

            <label class="block">
              <span class="block text-xs font-medium text-neutral-600">Client ID</span>
              <input
                v-model="form.client_id"
                type="text"
                required
                class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
              />
            </label>

            <label class="block">
              <span class="block text-xs font-medium text-neutral-600">Client Secret</span>
              <input
                v-model="form.client_secret"
                type="password"
                required
                placeholder="Re-enter even when editing — secrets are never returned by the API"
                class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 font-mono text-xs"
              />
            </label>

            <label class="flex items-center gap-2 text-sm">
              <input v-model="form.enabled" type="checkbox" />
              <span>Show this provider on the login page</span>
            </label>

            <p v-if="error" class="text-xs text-red-600">{{ error }}</p>

            <div class="flex justify-end gap-2">
              <button
                type="button"
                class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100"
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

    <!-- Branding/data placeholders -->
    <section class="rounded-lg border border-neutral-200 bg-white">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold">More</div>
      <ul class="divide-y divide-neutral-100 text-sm">
        <li class="flex items-center justify-between px-4 py-3">
          <div>
            <div class="font-medium">Custom domain, branding, theme</div>
            <div class="mt-0.5 text-xs text-neutral-500">Coming soon.</div>
          </div>
          <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">Soon</span>
        </li>
        <li class="flex items-center justify-between px-4 py-3">
          <div>
            <div class="font-medium">Telemetry retention &amp; export</div>
            <div class="mt-0.5 text-xs text-neutral-500">Coming soon.</div>
          </div>
          <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">Soon</span>
        </li>
      </ul>
    </section>
  </div>
</template>
