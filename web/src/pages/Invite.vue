<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { authClient } from '../lib/auth-client';
import { toast } from '../lib/toast';
import type { InvitePreview } from '../types';
import Spinner from '../components/Spinner.vue';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const token = computed(() => String(route.params['token'] ?? ''));
const loading = ref(true);
const preview = ref<InvitePreview | null>(null);
const providers = ref<('google' | 'github')[]>([]);
const form = ref({ first_name: '', last_name: '', password: '' });
const submitting = ref(false);

const roleLabel = computed(() =>
  preview.value?.instance_role === 'admin' ? 'Administrator' : 'Member'
);

onMounted(async () => {
  try {
    // OAuth invite acceptance is matched server-side by email, so the enabled
    // providers are the same public list the login page uses.
    const [iRes, pRes] = await Promise.all([
      fetch(`/v1/public/invite/${token.value}`, { credentials: 'include' }),
      fetch('/v1/public/auth-providers', { credentials: 'include' }),
    ]);
    preview.value = iRes.ok ? ((await iRes.json()) as InvitePreview) : { valid: false };
    if (pRes.ok) {
      providers.value = (await pRes.json() as { providers: ('google' | 'github')[] }).providers;
    }
  } catch {
    preview.value = { valid: false };
  } finally {
    loading.value = false;
  }
});

async function signInWith(provider: 'google' | 'github') {
  try {
    await authClient.signIn.social({ provider, callbackURL: `${location.origin}/` });
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function submit() {
  if (!preview.value?.valid) return;
  submitting.value = true;
  try {
    const name = [form.value.first_name.trim(), form.value.last_name.trim()].filter(Boolean).join(' ');
    const res = await fetch('/v1/public/invite/accept', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token: token.value, password: form.value.password, name }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string; reason?: string } | null;
      toast.error(body?.reason || body?.error || `Request failed (${res.status})`);
      return;
    }
    await session.load();
    router.replace('/');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <main class="mx-auto flex h-full max-w-md flex-col justify-center px-6 py-12">
    <div class="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      <div v-if="loading" class="flex justify-center py-8">
        <Spinner size="lg" />
      </div>

      <template v-else-if="!preview?.valid">
        <h1 class="text-xl font-semibold tracking-tight">Invite not valid</h1>
        <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          This invite link is invalid, has expired, or has already been used. Ask whoever
          invited you to send a fresh link.
        </p>
        <RouterLink to="/login" class="mt-4 inline-block text-sm text-accent-700 hover:underline dark:text-accent-400">
          Go to sign in →
        </RouterLink>
      </template>

      <template v-else>
        <h1 class="text-xl font-semibold tracking-tight">Accept your invite</h1>
        <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
          <span v-if="preview.inviter_email">{{ preview.inviter_email }} invited </span>
          <span v-else>You've been invited </span>
          to join this nodrix deployment as <span class="font-medium">{{ roleLabel }}</span>.
        </p>

        <form class="mt-5 space-y-3" @submit.prevent="submit">
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Email</span>
            <input
              :value="preview.email ?? ''"
              type="email"
              disabled
              class="mt-1 w-full rounded-md border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950"
            />
          </label>

          <div class="grid grid-cols-2 gap-3">
            <label class="block">
              <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">First name</span>
              <input
                v-model="form.first_name"
                type="text"
                required
                class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>
            <label class="block">
              <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Last name</span>
              <input
                v-model="form.last_name"
                type="text"
                class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
              />
            </label>
          </div>

          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Choose a password</span>
            <input
              v-model="form.password"
              type="password"
              required
              minlength="8"
              autocomplete="new-password"
              class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>

          <button
            type="submit"
            :disabled="submitting"
            class="w-full rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
          >{{ submitting ? '...' : 'Accept & create account' }}</button>
        </form>

        <div v-if="providers.length > 0" class="mt-5">
          <div class="relative flex items-center">
            <div class="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
            <span class="px-2 text-[11px] uppercase tracking-wide text-neutral-400 dark:text-neutral-500">or</span>
            <div class="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
          </div>
          <div class="mt-4 space-y-2">
            <button
              v-if="providers.includes('google')"
              type="button"
              class="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
              @click="signInWith('google')"
            >
              <svg viewBox="0 0 48 48" class="h-4 w-4">
                <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.6-6 8-11.3 8a12 12 0 1 1 7.9-21.1l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
                <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3.1 0 6 1.2 8.1 3.1l5.7-5.7A20 20 0 0 0 6.3 14.7z"/>
                <path fill="#4CAF50" d="M24 44a20 20 0 0 0 13.5-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.5 5A20 20 0 0 0 24 44z"/>
                <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4 5.6l6.2 5.2A20 20 0 0 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
              </svg>
              Continue with Google
            </button>
            <button
              v-if="providers.includes('github')"
              type="button"
              class="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:border-neutral-700 dark:bg-neutral-800 dark:hover:bg-neutral-700"
              @click="signInWith('github')"
            >
              <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor">
                <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.6-3.9-1.6-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/>
              </svg>
              Continue with GitHub
            </button>
          </div>
          <p class="mt-3 text-center text-[11px] text-neutral-500 dark:text-neutral-400">
            Use the account for <span class="font-medium">{{ preview.email }}</span> — other addresses won't match this invite.
          </p>
        </div>
      </template>
    </div>
  </main>
</template>
