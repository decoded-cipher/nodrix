<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import type { InvitePreview } from '../types';
import Spinner from '../components/Spinner.vue';

const route = useRoute();
const router = useRouter();
const session = useSessionStore();

const token = computed(() => String(route.params['token'] ?? ''));
const loading = ref(true);
const preview = ref<InvitePreview | null>(null);
const form = ref({ first_name: '', last_name: '', password: '' });
const submitting = ref(false);
const error = ref<string | null>(null);

const roleLabel = computed(() =>
  preview.value?.instance_role === 'admin' ? 'Administrator' : 'Member'
);

onMounted(async () => {
  try {
    const res = await fetch(`/v1/public/invite/${token.value}`, { credentials: 'include' });
    preview.value = res.ok ? ((await res.json()) as InvitePreview) : { valid: false };
  } catch {
    preview.value = { valid: false };
  } finally {
    loading.value = false;
  }
});

async function submit() {
  if (!preview.value?.valid) return;
  error.value = null;
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
      const body = (await res.json().catch(() => null)) as { reason?: string } | null;
      throw new Error(body?.reason || 'Could not accept invite');
    }
    await session.load();
    router.replace('/');
  } catch (e) {
    error.value = (e as Error).message;
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

          <p v-if="error" class="text-xs text-red-600 dark:text-red-400">{{ error }}</p>

          <button
            type="submit"
            :disabled="submitting"
            class="w-full rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
          >{{ submitting ? '...' : 'Accept & create account' }}</button>
        </form>
      </template>
    </div>
  </main>
</template>
