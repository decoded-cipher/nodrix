<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useProjectStore } from '../../stores/project';
import RevealOnce from '../../components/RevealOnce.vue';

const project = useProjectStore();
const scope = ref<'read' | 'admin'>('read');
const projectScoped = ref(true);
const justCreatedToken = ref<string | null>(null);

onMounted(() => project.loadTokens());

async function create() {
  const t = await project.createToken(scope.value, projectScoped.value);
  justCreatedToken.value = t.token;
}

async function revoke(id: string) {
  if (!confirm('Revoke this token? It will stop working immediately.')) return;
  await project.revokeToken(id);
}

function fmt(ts: number | null): string {
  return ts ? new Date(ts * 1000).toLocaleString() : '—';
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
      <div class="flex flex-wrap items-end gap-4">
        <label class="block">
          <span class="block text-xs font-medium text-neutral-600">Scope</span>
          <select v-model="scope" class="mt-1 rounded-md border border-neutral-300 px-3 py-2 text-sm">
            <option value="read">read</option>
            <option value="admin">admin</option>
          </select>
        </label>
        <label class="flex items-center gap-2 text-sm">
          <input v-model="projectScoped" type="checkbox" />
          <span>Limit to this project</span>
        </label>
        <button
          class="ml-auto rounded-md bg-orange-600 px-4 py-2 text-sm font-semibold text-white hover:bg-orange-700"
          @click="create"
        >Create token</button>
      </div>
    </section>

    <ul class="mt-6 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white">
      <li v-for="t in project.tokens" :key="t.id" class="flex items-center justify-between px-4 py-3 text-sm">
        <div>
          <div>
            <span class="font-mono text-xs">{{ t.id }}</span>
            <span class="ml-2 rounded bg-neutral-100 px-2 py-0.5 text-xs">{{ t.scope }}</span>
            <span v-if="t.project_id" class="ml-2 rounded bg-blue-50 px-2 py-0.5 text-xs">{{ t.project_id }}</span>
            <span v-else class="ml-2 rounded bg-amber-50 px-2 py-0.5 text-xs">all projects</span>
            <span v-if="t.revoked_at" class="ml-2 rounded bg-red-50 px-2 py-0.5 text-xs text-red-700">revoked</span>
          </div>
          <div class="mt-1 text-xs text-neutral-500">
            created {{ fmt(t.created_at) }} · last used {{ fmt(t.last_used_at) }}
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
