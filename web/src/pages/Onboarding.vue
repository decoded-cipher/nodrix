<script setup lang="ts">
// Owner-only setup wizard surfaced right after the first signup. The user's
// deployment is already running at this point; the wizard's only job is to
// capture a Cloudflare API token so the in-app "Update now" button works.
// "Skip for now" calls /v1/admin/update/dismiss so the auto-redirect doesn't
// re-fire for 24h.

import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { api } from '../api';

const router = useRouter();
const session = useSessionStore();

// Pre-scoped Cloudflare token wizard URL. The permission groups encode:
//   - Account · Workers Scripts · Edit  (redeploy)
//   - Account · Workers Builds · Edit   (trigger builds)
//   - Account · Account Settings · Read (extract account_id at validation)
// CF's permissionGroupKeys parameter accepts a JSON-encoded array of
// { key, type } pairs. The exact keys are the public-facing scope IDs.
const TOKEN_TEMPLATE_URL =
  'https://dash.cloudflare.com/profile/api-tokens?permissionGroupKeys=' +
  encodeURIComponent(
    JSON.stringify([
      { key: 'workers_scripts', type: 'edit' },
      { key: 'workers_builds', type: 'edit' },
      { key: 'account_settings', type: 'read' },
    ])
  );

type Step = 'welcome' | 'token' | 'paste' | 'done';
const step = ref<Step>('welcome');

const tokenInput = ref('');
const submitting = ref(false);
const error = ref<string | null>(null);

const accountName = ref<string | null>(null);

const currentHost = computed(() => location.host);

// Bail-outs for users who land here when they shouldn't:
//   - not signed in → /login
//   - not owner → /
//   - already configured → /
onMounted(async () => {
  if (!session.user) await session.load();
  if (!session.user) { router.replace('/login'); return; }
  if (session.user.role !== 'owner') { router.replace('/'); return; }
  try {
    const status = await api.get<{ configured: boolean }>('/v1/admin/update');
    if (status.configured) router.replace('/');
  } catch {
    // Endpoint failing is fine — onboarding still proceeds.
  }
});

async function submitToken() {
  const token = tokenInput.value.trim();
  if (!token) {
    error.value = 'Paste a token first.';
    return;
  }
  submitting.value = true;
  error.value = null;
  try {
    const res = await api.post<{ configured: boolean; account_name: string }>(
      '/v1/admin/update/config',
      { token }
    );
    accountName.value = res.account_name;
    step.value = 'done';
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    submitting.value = false;
  }
}

async function skipForNow() {
  try { await api.post<void>('/v1/admin/update/dismiss'); } catch { /* best-effort */ }
  router.replace('/');
}

function finish() { router.replace('/'); }
</script>

<template>
  <main class="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-6 py-12">
    <div class="rounded-2xl border border-neutral-200 bg-white p-8 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <!-- Step indicator -->
      <div class="mb-6 flex items-center gap-2 text-[11px] uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        <span :class="step === 'welcome' ? 'font-semibold text-orange-700 dark:text-orange-400' : ''">Welcome</span>
        <span class="text-neutral-300 dark:text-neutral-700">→</span>
        <span :class="step === 'token' ? 'font-semibold text-orange-700 dark:text-orange-400' : ''">Generate token</span>
        <span class="text-neutral-300 dark:text-neutral-700">→</span>
        <span :class="step === 'paste' ? 'font-semibold text-orange-700 dark:text-orange-400' : ''">Paste &amp; verify</span>
        <span class="text-neutral-300 dark:text-neutral-700">→</span>
        <span :class="step === 'done' ? 'font-semibold text-emerald-700 dark:text-emerald-400' : ''">Done</span>
      </div>

      <!-- Welcome -->
      <section v-if="step === 'welcome'">
        <h1 class="text-2xl font-semibold tracking-tight">Welcome to nodrix</h1>
        <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Your deployment is running at
          <span class="font-mono text-neutral-900 dark:text-neutral-100">{{ currentHost }}</span>.
        </p>
        <p class="mt-4 text-sm text-neutral-600 dark:text-neutral-400">
          One last step: enable in-app updates. When new versions land on the upstream repo,
          you'll see an <span class="font-medium">Update now</span> button right in Settings
          — one click and your deployment redeploys with the latest code, no Cloudflare dashboard,
          no CLI, no git pushes. Setup takes about 2 minutes.
        </p>
        <div class="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            class="text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            @click="skipForNow"
          >Skip for now</button>
          <button
            type="button"
            class="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
            @click="step = 'token'"
          >Continue →</button>
        </div>
      </section>

      <!-- Generate token -->
      <section v-else-if="step === 'token'">
        <h1 class="text-xl font-semibold tracking-tight">Generate a Cloudflare API token</h1>
        <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          The token lets nodrix trigger redeploys on your behalf — nothing else.
          It's stored encrypted in your deployment's database, never sent anywhere
          except Cloudflare's API.
        </p>

        <div class="mt-4 rounded-md border border-neutral-200 bg-neutral-50 p-3 text-xs text-neutral-700 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300">
          <div class="font-semibold text-neutral-900 dark:text-neutral-100">Required scopes</div>
          <ul class="mt-1.5 list-disc space-y-0.5 pl-5">
            <li><span class="font-mono">Account · Workers Scripts · Edit</span> — to redeploy</li>
            <li><span class="font-mono">Account · Workers Builds · Edit</span> — to trigger builds</li>
            <li><span class="font-mono">Account · Account Settings · Read</span> — to identify your account</li>
          </ul>
        </div>

        <ol class="mt-5 space-y-2 pl-5 text-sm text-neutral-700 list-decimal dark:text-neutral-300">
          <li>Click the button below to open Cloudflare's token wizard with the right scopes pre-selected.</li>
          <li>Click <span class="font-medium">Continue to summary</span>, then <span class="font-medium">Create Token</span>.</li>
          <li>Copy the token Cloudflare shows you — it's shown once.</li>
          <li>Come back here and paste it on the next screen.</li>
        </ol>

        <div class="mt-6 flex flex-wrap items-center justify-between gap-3">
          <button
            type="button"
            class="text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            @click="step = 'welcome'"
          >← Back</button>
          <div class="flex items-center gap-2">
            <a
              :href="TOKEN_TEMPLATE_URL"
              target="_blank"
              rel="noreferrer"
              class="rounded-md border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
            >Open token wizard ↗</a>
            <button
              type="button"
              class="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
              @click="step = 'paste'"
            >I have my token →</button>
          </div>
        </div>
      </section>

      <!-- Paste & verify -->
      <section v-else-if="step === 'paste'">
        <h1 class="text-xl font-semibold tracking-tight">Paste your token</h1>
        <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          We'll validate it against Cloudflare's API and save it encrypted.
        </p>

        <label class="mt-5 block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Cloudflare API token</span>
          <input
            v-model="tokenInput"
            type="password"
            placeholder="Paste your token here"
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-xs dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            autocomplete="off"
            @keydown.enter.prevent="submitToken"
          />
        </label>

        <p v-if="error" class="mt-2 text-xs text-red-600 dark:text-red-400">{{ error }}</p>

        <div class="mt-6 flex items-center justify-between gap-3">
          <button
            type="button"
            class="text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
            @click="step = 'token'"
          >← Back</button>
          <button
            type="button"
            :disabled="submitting || !tokenInput.trim()"
            class="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
            @click="submitToken"
          >{{ submitting ? 'Validating…' : 'Validate & save' }}</button>
        </div>
      </section>

      <!-- Done -->
      <section v-else-if="step === 'done'">
        <div class="grid h-12 w-12 place-items-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300">
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="h-6 w-6">
            <path d="M5 12l5 5L20 7" />
          </svg>
        </div>
        <h1 class="mt-4 text-xl font-semibold tracking-tight">Setup complete</h1>
        <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Token validated against
          <span class="font-mono text-neutral-900 dark:text-neutral-100">{{ accountName ?? 'your Cloudflare account' }}</span>.
          You'll see updates surface in Settings → Version &amp; updates when new commits land upstream.
        </p>
        <div class="mt-6 flex justify-end">
          <button
            type="button"
            class="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
            @click="finish"
          >Go to dashboard</button>
        </div>
      </section>
    </div>

    <p class="mt-4 text-center text-[11px] text-neutral-500 dark:text-neutral-400">
      Token is stored encrypted with AES-GCM using your deployment's session-signing secret.
      Only you (the owner) can configure or remove it.
    </p>
  </main>
</template>
