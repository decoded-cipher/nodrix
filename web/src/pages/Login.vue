<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import { authClient } from '../lib/auth-client';
import Spinner from '../components/Spinner.vue';

const session = useSessionStore();
const router = useRouter();

// Bootstrap detection: ask the worker how many users exist so we can show
// the registration form instead of login when the deployment is empty.
const bootstrap = ref<boolean | null>(null);
const providers = ref<('google' | 'github')[]>([]);
const loadingProviders = ref(true);

const mode = computed<'login' | 'register'>(() => (bootstrap.value ? 'register' : 'login'));

const form = ref({ email: '', password: '', first_name: '', last_name: '' });
const submitting = ref(false);
const error = ref<string | null>(null);

onMounted(async () => {
  // Public endpoint: returns 200 in both cases. We piggy-back the providers
  // endpoint to detect bootstrap by checking total users via a side endpoint.
  try {
    const [pRes, bRes] = await Promise.all([
      fetch('/v1/public/auth-providers', { credentials: 'include' }),
      fetch('/v1/public/bootstrap-status', { credentials: 'include' }),
    ]);
    if (pRes.ok) {
      const data = await pRes.json() as { providers: ('google' | 'github')[] };
      providers.value = data.providers;
    }
    if (bRes.ok) {
      const data = await bRes.json() as { bootstrap: boolean };
      bootstrap.value = data.bootstrap;
    } else {
      bootstrap.value = false;
    }
  } finally {
    loadingProviders.value = false;
  }
});

async function submit() {
  error.value = null;
  submitting.value = true;
  try {
    if (mode.value === 'register') {
      // Worker's after-hook splits `name` into first_name/last_name.
      const name = [form.value.first_name.trim(), form.value.last_name.trim()]
        .filter(Boolean).join(' ') || form.value.email;
      const res = await authClient.signUp.email({
        email: form.value.email.trim(),
        password: form.value.password,
        name,
      });
      if (res.error) throw new Error(res.error.message ?? 'Sign-up failed');
    } else {
      const res = await authClient.signIn.email({
        email: form.value.email.trim(),
        password: form.value.password,
      });
      if (res.error) throw new Error(res.error.message ?? 'Sign-in failed');
    }
    await session.load();
    router.replace('/');
  } catch (e) {
    error.value = (e as Error).message;
  } finally {
    submitting.value = false;
  }
}

async function signInWith(provider: 'google' | 'github') {
  error.value = null;
  try {
    await authClient.signIn.social({
      provider,
      callbackURL: `${location.origin}/`,
    });
  } catch (e) {
    error.value = (e as Error).message;
  }
}
</script>

<template>
  <main class="mx-auto flex h-full max-w-md flex-col justify-center px-6 py-12">
    <div class="rounded-xl border border-neutral-200 bg-white p-6 shadow-sm">
      <h1 class="text-xl font-semibold tracking-tight">
        {{ mode === 'register' ? 'Create owner account' : 'Sign in to nodrix' }}
      </h1>
      <p v-if="mode === 'register'" class="mt-1 text-sm text-neutral-600">
        First account becomes the owner of this deployment.
      </p>

      <form class="mt-5 space-y-3" @submit.prevent="submit">
        <div v-if="mode === 'register'" class="grid grid-cols-2 gap-3">
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600">First name</span>
            <input
              v-model="form.first_name"
              type="text"
              required
              class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600">Last name</span>
            <input
              v-model="form.last_name"
              type="text"
              class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <label class="block">
          <span class="block text-xs font-medium text-neutral-600">Email</span>
          <input
            v-model="form.email"
            type="email"
            required
            autocomplete="email"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
            placeholder="you@example.com"
          />
        </label>

        <label class="block">
          <span class="block text-xs font-medium text-neutral-600">Password</span>
          <input
            v-model="form.password"
            type="password"
            required
            minlength="8"
            :autocomplete="mode === 'register' ? 'new-password' : 'current-password'"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>

        <p v-if="error" class="text-xs text-red-600">{{ error }}</p>

        <button
          type="submit"
          :disabled="submitting"
          class="w-full rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700 disabled:opacity-50"
        >{{ submitting ? '...' : mode === 'register' ? 'Create account' : 'Sign in' }}</button>
      </form>

      <div v-if="mode === 'login' && providers.length > 0" class="mt-5">
        <div class="relative flex items-center">
          <div class="flex-1 border-t border-neutral-200" />
          <span class="px-2 text-[11px] uppercase tracking-wide text-neutral-400">or</span>
          <div class="flex-1 border-t border-neutral-200" />
        </div>
        <div class="mt-4 space-y-2">
          <button
            v-if="providers.includes('google')"
            type="button"
            class="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 px-4 py-2 text-sm font-medium hover:bg-neutral-50"
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
            class="flex w-full items-center justify-center gap-2 rounded-md border border-neutral-300 bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800"
            @click="signInWith('github')"
          >
            <svg viewBox="0 0 24 24" class="h-4 w-4" fill="currentColor">
              <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.3.8-.6v-2c-3.2.7-3.9-1.6-3.9-1.6-.5-1.3-1.3-1.7-1.3-1.7-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.4 1 .1-.8.4-1.3.8-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.2 1.2.9-.3 1.9-.4 2.9-.4s2 .1 2.9.4c2.2-1.5 3.2-1.2 3.2-1.2.6 1.6.2 2.8.1 3.1.7.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z"/>
            </svg>
            Continue with GitHub
          </button>
        </div>
      </div>

      <div v-if="loadingProviders" class="mt-4 flex justify-center">
        <Spinner size="sm" label="Checking sign-in options…" />
      </div>
    </div>
  </main>
</template>
