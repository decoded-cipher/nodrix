<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useProjectStore } from '../../stores/project';
import RevealOnce from '../../components/RevealOnce.vue';
import { confirm } from '../../lib/confirm';

const project = useProjectStore();
const scope = ref<'read' | 'admin'>('read');
const projectScoped = ref(true);
const tokenName = ref('');
const expiresInDays = ref<number | ''>('');
const justCreatedToken = ref<string | null>(null);

onMounted(() => project.loadTokens());

async function create() {
  const expiresAt = typeof expiresInDays.value === 'number' && expiresInDays.value > 0
    ? Math.floor(Date.now() / 1000) + expiresInDays.value * 86400
    : null;
  const t = await project.createToken(scope.value, projectScoped.value, {
    name: tokenName.value.trim() || null,
    expires_at: expiresAt,
  });
  justCreatedToken.value = t.token;
  tokenName.value = '';
  expiresInDays.value = '';
}

async function revoke(id: string) {
  const t = project.tokens.find((x) => x.id === id);
  const label = t?.name ?? id;
  const ok = await confirm({
    title: `Revoke API token "${label}"?`,
    message: 'The token stops working immediately. Any scripts or integrations using it will fail until you issue a new token.',
    details: [
      `Scope: ${t?.scope ?? 'unknown'}`,
      t?.project_id ? `Project: ${t.project_id}` : 'Scope: all projects',
    ],
    confirmLabel: 'Revoke token',
  });
  if (!ok) return;
  await project.revokeToken(id);
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
    <h2 class="text-xl font-semibold tracking-tight">API tokens</h2>
    <p class="mt-1 text-sm text-neutral-600">
      For external apps (Grafana, scripts, dashboards). Browser sessions use Cloudflare Access.
    </p>

    <RevealOnce
      v-if="justCreatedToken"
      :value="justCreatedToken"
      label="API token"
      class="mt-6"
    />

    <section class="mt-6 rounded-lg border border-neutral-200 bg-white p-4">
      <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
        <label class="block">
          <span class="block text-xs font-medium text-neutral-600">Name (optional)</span>
          <input
            v-model="tokenName"
            type="text"
            placeholder="e.g. Grafana — read-only"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <label class="block">
          <span class="block text-xs font-medium text-neutral-600">Expires in (days)</span>
          <input
            v-model.number="expiresInDays"
            type="number"
            min="1"
            placeholder="leave blank for no expiry"
            class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm"
          />
        </label>
        <label class="block">
          <span class="block text-xs font-medium text-neutral-600">Scope</span>
          <select v-model="scope" class="mt-1 w-full rounded-md border border-neutral-300 px-3 py-2 text-sm">
            <option value="read">read</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label class="flex items-end gap-2 text-sm">
          <input v-model="projectScoped" type="checkbox" class="mb-2.5" />
          <span class="mb-2.5">Limit to this project</span>
        </label>
      </div>
      <div class="mt-3 flex justify-end">
        <button
          class="rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          @click="create"
        >Create token</button>
      </div>
    </section>

    <ul class="mt-6 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
      <li v-for="t in project.tokens" :key="t.id" class="flex items-start justify-between gap-4 px-4 py-3 text-sm">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{{ t.name ?? 'Unnamed token' }}</span>
            <span class="rounded bg-neutral-100 px-2 py-0.5 text-xs">{{ t.scope }}</span>
            <span v-if="t.project_id" class="rounded bg-blue-50 px-2 py-0.5 text-xs">{{ t.project_id }}</span>
            <span v-else class="rounded bg-amber-50 px-2 py-0.5 text-xs">all projects</span>
            <span v-if="t.revoked_at" class="rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">revoked</span>
          </div>
          <div class="mt-1 font-mono text-[11px] text-neutral-500">{{ t.id }}</div>
          <div class="mt-1 text-xs text-neutral-500">
            created {{ fmt(t.created_at) }} · last used {{ fmt(t.last_used_at) }} · {{ expiryLabel(t.expires_at) }}
          </div>
        </div>
        <button
          v-if="!t.revoked_at"
          class="rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50"
          @click="revoke(t.id)"
        >Revoke</button>
      </li>
      <li v-if="project.tokens.length === 0" class="px-4 py-6 text-sm text-neutral-500">
        No tokens yet.
      </li>
    </ul>
  </main>
</template>
