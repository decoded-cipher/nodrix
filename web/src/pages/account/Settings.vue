<script setup lang="ts">
import { ref } from 'vue';
import { useSessionStore } from '../../stores/session';
import { clearDevEmail, getDevEmail } from '../../api';

const session = useSessionStore();
const devEmail = ref(getDevEmail());

function signOut() {
  // In dev: clear the impersonation header. In prod: Cloudflare Access controls sessions.
  clearDevEmail();
  location.href = '/setup';
}

type SectionItem = {
  title: string;
  desc: string;
  status: 'available' | 'soon';
};

const branding: SectionItem[] = [
  { title: 'Custom domain', desc: 'Serve nodrix from your own domain (e.g. iot.acme.com).', status: 'soon' },
  { title: 'Logo & favicon', desc: 'Replace the default branding on the sidebar and login page.', status: 'soon' },
  { title: 'Theme colors', desc: 'Override the accent color and surface palette.', status: 'soon' },
  { title: 'Font', desc: 'Swap in a custom typeface for the whole app.', status: 'soon' },
];

const data: SectionItem[] = [
  { title: 'Telemetry retention', desc: 'How long to keep cold telemetry in R2 before pruning.', status: 'soon' },
  { title: 'Export', desc: 'Download a snapshot of metadata and historical data.', status: 'soon' },
];
</script>

<template>
  <div class="mx-auto max-w-3xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">Settings</h1>
      <p class="mt-1 text-sm text-neutral-600">
        Deployment-wide configuration. For project-specific settings, open a project and go to
        <span class="font-medium">Project → Settings</span>.
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
        <div v-if="devEmail" class="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Dev sign-in is active (<span class="font-mono">{{ devEmail }}</span>). In production, Cloudflare Access takes over.
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

    <!-- Branding -->
    <section class="mb-6 rounded-lg border border-neutral-200 bg-white">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold">Branding &amp; appearance</div>
      <ul class="divide-y divide-neutral-100 text-sm">
        <li v-for="b in branding" :key="b.title" class="flex items-center justify-between px-4 py-3">
          <div>
            <div class="font-medium">{{ b.title }}</div>
            <div class="mt-0.5 text-xs text-neutral-500">{{ b.desc }}</div>
          </div>
          <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
            {{ b.status === 'soon' ? 'Coming soon' : 'Available' }}
          </span>
        </li>
      </ul>
    </section>

    <!-- Data -->
    <section class="rounded-lg border border-neutral-200 bg-white">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold">Data</div>
      <ul class="divide-y divide-neutral-100 text-sm">
        <li v-for="d in data" :key="d.title" class="flex items-center justify-between px-4 py-3">
          <div>
            <div class="font-medium">{{ d.title }}</div>
            <div class="mt-0.5 text-xs text-neutral-500">{{ d.desc }}</div>
          </div>
          <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] uppercase tracking-wide text-neutral-500">
            {{ d.status === 'soon' ? 'Coming soon' : 'Available' }}
          </span>
        </li>
      </ul>
    </section>
  </div>
</template>
