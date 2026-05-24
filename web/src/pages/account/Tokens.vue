<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useProjectStore } from '../../stores/project';
import { useSessionStore } from '../../stores/session';
import RevealOnce from '../../components/RevealOnce.vue';
import Dropdown from '../../components/Dropdown.vue';
import { confirm } from '../../lib/confirm';
import { toast } from '../../lib/toast';

const project = useProjectStore();
const session = useSessionStore();

const scopeOptions = [
  { value: 'read' as const, label: 'Read', hint: 'Read data and stream updates.' },
  { value: 'admin' as const, label: 'Admin', hint: 'Full control: read, write, manage.' },
];
const projectOptions = computed(() => [
  { value: '', label: 'All projects' },
  ...session.projects.map((p) => ({ value: p.id, label: p.name })),
]);
const expiryDate = (days: number) =>
  new Date(Date.now() + days * 86400_000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
const expiryOptions = computed(() => [
  { value: 7, label: '7 days', meta: expiryDate(7) },
  { value: 30, label: '30 days', meta: expiryDate(30) },
  { value: 60, label: '60 days', meta: expiryDate(60) },
  { value: 90, label: '90 days', meta: expiryDate(90) },
  { value: 0, label: 'Never' },
]);

const scope = ref<'read' | 'admin'>('read');
const projectId = ref<string>(''); // '' = all projects
const tokenName = ref('');
const expiresInDays = ref<number>(0); // 0 = never
const creating = ref(false);
const justCreatedToken = ref<string | null>(null);

onMounted(() => { project.loadTokens(); });

const projectName = (id: string | null) =>
  id ? session.projects.find((p) => p.id === id)?.name ?? id : null;

async function create() {
  const expiresAt =
    expiresInDays.value > 0
      ? Math.floor(Date.now() / 1000) + expiresInDays.value * 86400
      : null;
  creating.value = true;
  try {
    const t = await project.createToken(scope.value, projectId.value || null, {
      name: tokenName.value.trim() || null,
      expires_at: expiresAt,
    });
    justCreatedToken.value = t.token;
    tokenName.value = '';
    expiresInDays.value = 0;
    scope.value = 'read';
    projectId.value = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    creating.value = false;
  }
}

async function revoke(id: string) {
  const t = project.tokens.find((x) => x.id === id);
  const ok = await confirm({
    title: `Revoke API token "${t?.name ?? id}"?`,
    message: 'The token stops working immediately. Any scripts or integrations using it will fail until you issue a new one.',
    details: [
      `Scope: ${t?.scope ?? 'unknown'}`,
      t?.project_id ? `Project: ${projectName(t.project_id)}` : 'All projects',
    ],
    confirmLabel: 'Revoke token',
  });
  if (!ok) return;
  try {
    await project.revokeToken(id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

function fmt(ts: number | null): string {
  return ts ? new Date(ts * 1000).toLocaleString() : '—';
}

function expiryLabel(ts: number | null | undefined): string {
  if (!ts) return 'No expiry';
  const now = Math.floor(Date.now() / 1000);
  const when = new Date(ts * 1000).toLocaleDateString();
  return ts < now ? `Expired ${when}` : `Expires ${when}`;
}
</script>

<template>
  <main class="mx-auto max-w-4xl px-6 py-8">
    <header class="mb-6">
      <h1 class="text-xl font-semibold tracking-tight">API tokens</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        For external apps — Grafana, scripts, dashboards. Browser sessions use signed-in cookies, not these.
      </p>
    </header>

    <RevealOnce v-if="justCreatedToken" :value="justCreatedToken" label="New API token" class="mb-6" />

    <!-- Create -->
    <section class="rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">Create a token</div>
      <form class="space-y-4 px-4 py-4" @submit.prevent="create">
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Name</span>
            <input
              v-model="tokenName"
              type="text"
              placeholder="e.g. Grafana — read-only"
              class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </label>
          <label class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Expires in</span>
            <Dropdown v-model="expiresInDays" :options="expiryOptions" class="mt-1" />
          </label>
          <div class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Scope</span>
            <Dropdown v-model="scope" :options="scopeOptions" class="mt-1" />
          </div>
          <div class="block">
            <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Project</span>
            <Dropdown v-model="projectId" :options="projectOptions" class="mt-1" />
          </div>
        </div>

        <div class="flex items-center justify-between gap-3">
          <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
            {{ projectId ? 'Scoped to one project.' : 'Works across every project.' }}
          </p>
          <button
            type="submit"
            :disabled="creating"
            class="shrink-0 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
          >{{ creating ? 'Creating…' : 'Create token' }}</button>
        </div>
      </form>
    </section>

    <!-- List -->
    <section class="mt-6 rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="border-b border-neutral-100 px-4 py-3 text-sm font-semibold dark:border-neutral-800">Your tokens</div>
      <ul class="divide-y divide-neutral-100 dark:divide-neutral-800">
        <li v-for="t in project.tokens" :key="t.id" class="flex items-start justify-between gap-4 px-4 py-3 text-sm">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="font-medium" :class="t.revoked_at ? 'text-neutral-400 line-through dark:text-neutral-500' : ''">{{ t.name ?? 'Unnamed token' }}</span>
              <span class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300">{{ t.scope }}</span>
              <span
                class="rounded-full px-2 py-0.5 text-[10px] font-medium"
                :class="t.project_id
                  ? 'bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300'
                  : 'bg-neutral-100 text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400'"
              >{{ t.project_id ? projectName(t.project_id) : 'All projects' }}</span>
              <span v-if="t.revoked_at" class="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-700 dark:bg-red-900/30 dark:text-red-300">Revoked</span>
            </div>
            <div class="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
              Created {{ fmt(t.created_at) }} · last used {{ fmt(t.last_used_at) }} · {{ expiryLabel(t.expires_at) }}
            </div>
          </div>
          <button
            v-if="!t.revoked_at"
            type="button"
            class="shrink-0 rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            @click="revoke(t.id)"
          >Revoke</button>
        </li>
        <li v-if="project.tokens.length === 0" class="px-4 py-8 text-center text-sm text-neutral-500 dark:text-neutral-400">
          No tokens yet.
        </li>
      </ul>
    </section>
  </main>
</template>
