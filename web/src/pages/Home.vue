<script setup lang="ts">
import { onMounted, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { useSessionStore } from '../stores/session';
import ProjectList from './ProjectList.vue';

const session = useSessionStore();
const router = useRouter();

onMounted(() => session.load());

watchEffect(() => {
  if (session.error && session.error.status === 401) {
    router.replace('/setup');
  }
});
</script>

<template>
  <div v-if="session.loading" class="flex h-full items-center justify-center text-neutral-500">
    Loading...
  </div>
  <div v-else-if="session.error" class="flex h-full items-center justify-center">
    <div class="max-w-md text-center">
      <h2 class="text-lg font-semibold">Sign-in required</h2>
      <p class="mt-2 text-sm text-neutral-600">
        Status {{ session.error.status }}<span v-if="session.error.reason">: {{ session.error.reason }}</span>
      </p>
      <RouterLink to="/setup" class="mt-4 inline-block text-sm text-orange-600 hover:underline">
        Continue to setup
      </RouterLink>
    </div>
  </div>
  <ProjectList v-else />
</template>
