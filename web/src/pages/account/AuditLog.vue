<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSessionStore } from '../../stores/session';

const session = useSessionStore();
const loading = ref(false);
const filter = ref('');

onMounted(async () => {
  loading.value = true;
  try { await session.loadAuditLog(true); } finally { loading.value = false; }
});

async function loadMore() {
  if (!session.auditLogNextBefore) return;
  loading.value = true;
  try { await session.loadAuditLog(false); } finally { loading.value = false; }
}

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function actionTone(action: string): string {
  if (action.endsWith('.delete')) return 'bg-red-50 text-red-700 ring-red-200';
  if (action.endsWith('.create')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200';
  if (action.endsWith('.enable') || action.endsWith('.disable'))
    return 'bg-amber-50 text-amber-800 ring-amber-200';
  if (action.endsWith('.update')) return 'bg-blue-50 text-blue-700 ring-blue-200';
  if (action.endsWith('.revoke')) return 'bg-orange-50 text-orange-700 ring-orange-200';
  return 'bg-neutral-100 text-neutral-700 ring-neutral-200';
}

const filtered = computed(() => {
  const q = filter.value.trim().toLowerCase();
  if (!q) return session.auditLog;
  return session.auditLog.filter((e) =>
    e.action.toLowerCase().includes(q) ||
    (e.target_id ?? '').toLowerCase().includes(q) ||
    (e.target_type ?? '').toLowerCase().includes(q) ||
    (e.user_email ?? '').toLowerCase().includes(q) ||
    (e.project_name ?? '').toLowerCase().includes(q)
  );
});
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-8">
    <header class="mb-5">
      <h1 class="text-xl font-semibold tracking-tight">Audit log</h1>
      <p class="mt-1 text-sm text-neutral-600">
        Append-only record of changes across every project you have access to. Newest first.
      </p>
    </header>

    <div class="mb-4 flex gap-2">
      <input
        v-model="filter"
        type="text"
        placeholder="Filter by action, project, target, user…"
        class="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm focus:border-orange-500 focus:outline-none"
      />
    </div>

    <div class="overflow-hidden rounded-lg border border-neutral-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-neutral-100 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500">
          <tr>
            <th class="px-4 py-2 font-medium">When</th>
            <th class="px-4 py-2 font-medium">Action</th>
            <th class="px-4 py-2 font-medium">Project</th>
            <th class="px-4 py-2 font-medium">Target</th>
            <th class="px-4 py-2 font-medium">By</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-neutral-100">
          <tr v-for="e in filtered" :key="e.id" class="hover:bg-neutral-50">
            <td class="px-4 py-2 text-xs text-neutral-600">{{ fmt(e.created_at) }}</td>
            <td class="px-4 py-2">
              <span
                class="rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
                :class="actionTone(e.action)"
              >{{ e.action }}</span>
            </td>
            <td class="px-4 py-2 text-xs">
              <span v-if="e.project_name" class="text-neutral-700">{{ e.project_name }}</span>
              <span v-else class="text-neutral-400">—</span>
            </td>
            <td class="px-4 py-2 text-xs">
              <span v-if="e.target_type" class="text-neutral-500">{{ e.target_type }}</span>
              <span v-if="e.target_id" class="ml-1 font-mono text-neutral-700">{{ e.target_id }}</span>
              <span v-if="!e.target_type && !e.target_id" class="text-neutral-400">—</span>
            </td>
            <td class="px-4 py-2 text-xs text-neutral-600">
              {{ e.user_email ?? '—' }}
            </td>
          </tr>
          <tr v-if="!loading && filtered.length === 0">
            <td colspan="5" class="px-4 py-10 text-center text-sm text-neutral-500">
              No entries.
            </td>
          </tr>
          <tr v-if="loading && session.auditLog.length === 0">
            <td colspan="5" class="px-4 py-10 text-center text-sm text-neutral-500">
              Loading…
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="session.auditLogNextBefore" class="mt-4 text-center">
      <button
        type="button"
        :disabled="loading"
        class="rounded-md border border-neutral-300 px-4 py-1.5 text-xs hover:bg-neutral-100 disabled:opacity-50"
        @click="loadMore"
      >{{ loading ? 'Loading…' : 'Load more' }}</button>
    </div>
  </main>
</template>
