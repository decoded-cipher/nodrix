<script setup lang="ts">
import { onMounted } from 'vue';
import { useSessionStore } from '../../stores/session';

const session = useSessionStore();

onMounted(() => {
  if (!session.user) session.load();
});
</script>

<template>
  <div class="mx-auto max-w-4xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Users</h1>
      <p class="mt-1 text-sm text-neutral-600">
        People with access to this deployment. Sign-in is handled by Cloudflare Access — invite
        users by adding them to your Access policy.
      </p>
    </header>

    <section class="rounded-lg border border-neutral-200 bg-white">
      <ul class="divide-y divide-neutral-100">
        <li v-if="session.user" class="flex items-center justify-between px-4 py-3">
          <div class="flex items-center gap-3">
            <div class="grid h-8 w-8 place-items-center rounded-full bg-orange-100 text-xs font-semibold text-orange-700">
              {{ (session.user.email.split('@')[0] ?? '').slice(0, 2).toUpperCase() }}
            </div>
            <div>
              <div class="text-sm font-medium">{{ session.user.email }}</div>
              <div class="text-[11px] uppercase tracking-wide text-neutral-500">{{ session.user.role }}</div>
            </div>
          </div>
          <span class="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-emerald-700">You</span>
        </li>
      </ul>
    </section>

    <section class="mt-6 rounded-lg border border-dashed border-neutral-300 bg-white p-6">
      <h3 class="text-sm font-semibold">Multi-user management is on the roadmap</h3>
      <p class="mt-2 text-xs text-neutral-600">
        For now, anyone who satisfies your Cloudflare Access policy can sign in. Per-user roles,
        per-project access, and invitations land in a future release.
      </p>
    </section>
  </div>
</template>
