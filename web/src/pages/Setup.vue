<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { setDevEmail, getDevEmail } from '../api';
import { useSessionStore } from '../stores/session';

const router = useRouter();
const session = useSessionStore();
const email = ref(getDevEmail() ?? '');
const error = ref<string | null>(null);

async function submit() {
  if (!email.value.includes('@')) {
    error.value = 'Enter a valid email';
    return;
  }
  setDevEmail(email.value.trim());
  await session.load();
  if (session.user) {
    router.replace('/');
  } else {
    error.value = `Sign-in failed: ${session.error?.status ?? '?'}`;
  }
}
</script>

<template>
  <main class="mx-auto flex h-full max-w-md flex-col justify-center px-6">
    <h1 class="text-2xl font-semibold tracking-tight">First-time setup</h1>
    <p class="mt-2 text-sm text-neutral-600">
      In production, sign-in is handled by Cloudflare Access — the page just works. In local dev,
      enter the email you want to claim as the owner of this deployment.
    </p>

    <form class="mt-6 space-y-4" @submit.prevent="submit">
      <label class="block">
        <span class="text-sm font-medium">Email</span>
        <input
          v-model="email"
          type="email"
          placeholder="you@example.com"
          class="mt-1 block w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-orange-500 focus:outline-none"
        />
      </label>
      <button
        type="submit"
        class="w-full rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
      >
        Continue
      </button>
      <p v-if="error" class="text-sm text-red-600">{{ error }}</p>
    </form>
  </main>
</template>
