<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useSessionStore } from '../../stores/session';
import Spinner from '../../components/Spinner.vue';

const session = useSessionStore();
const loading = ref(false);
const filter = ref('');

onMounted(async () => {
  loading.value = true;
  try { await session.loadAuditLog(1); } finally { loading.value = false; }
});

async function goto(page: number) {
  if (page < 1 || page > session.auditLogPageCount) return;
  loading.value = true;
  try { await session.loadAuditLog(page); } finally { loading.value = false; }
}

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function actionTone(action: string): string {
  if (action === 'user.register') return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800';
  if (action === 'user.login')    return 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800';
  if (action === 'user.logout')   return 'bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700';
  if (action.endsWith('.delete')) return 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800';
  if (action.endsWith('.create')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800';
  if (action.endsWith('.enable') || action.endsWith('.disable'))
    return 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800';
  if (action.endsWith('.update')) return 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800';
  if (action.endsWith('.revoke')) return 'bg-accent-50 text-accent-700 ring-accent-200 dark:bg-accent-900/30 dark:text-accent-300 dark:ring-accent-800';
  return 'bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700';
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

// Compact page-list with ellipsis: 1 … (cur-1) (cur) (cur+1) … N.
const pageItems = computed<(number | '…')[]>(() => {
  const total = session.auditLogPageCount;
  const cur = session.auditLogPage;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: (number | '…')[] = [1];
  const start = Math.max(2, cur - 1);
  const end = Math.min(total - 1, cur + 1);
  if (start > 2) items.push('…');
  for (let i = start; i <= end; i++) items.push(i);
  if (end < total - 1) items.push('…');
  items.push(total);
  return items;
});

const rangeStart = computed(() =>
  session.auditLogTotal === 0 ? 0 : (session.auditLogPage - 1) * session.auditLogPageSize + 1
);
const rangeEnd = computed(() =>
  Math.min(session.auditLogTotal, session.auditLogPage * session.auditLogPageSize)
);
</script>

<template>
  <main class="mx-auto max-w-5xl px-6 py-8">
    <header class="mb-5">
      <h1 class="text-xl font-semibold tracking-tight">Audit log</h1>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Append-only record of changes across every project you have access to. Newest first.
      </p>
    </header>

    <div class="mb-4 flex gap-2">
      <input
        v-model="filter"
        type="text"
        placeholder="Filter the current page by action, project, target, user…"
        class="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
    </div>

    <div class="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-neutral-100 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
          <tr>
            <th class="px-4 py-2 font-medium">When</th>
            <th class="px-4 py-2 font-medium">Action</th>
            <th class="px-4 py-2 font-medium">Project</th>
            <th class="px-4 py-2 font-medium">Target</th>
            <th class="px-4 py-2 font-medium">By</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-neutral-100 dark:divide-neutral-800">
          <tr v-for="e in filtered" :key="e.id" class="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
            <td class="px-4 py-2 text-xs text-neutral-600 dark:text-neutral-400">{{ fmt(e.created_at) }}</td>
            <td class="px-4 py-2">
              <span
                class="rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
                :class="actionTone(e.action)"
              >{{ e.action }}</span>
            </td>
            <td class="px-4 py-2 text-xs">
              <span v-if="e.project_name" class="text-neutral-700 dark:text-neutral-300">{{ e.project_name }}</span>
              <span v-else class="text-neutral-400 dark:text-neutral-600">—</span>
            </td>
            <td class="px-4 py-2 text-xs">
              <span v-if="e.target_type" class="text-neutral-500 dark:text-neutral-400">{{ e.target_type }}</span>
              <span v-if="e.target_id" class="ml-1 font-mono text-neutral-700 dark:text-neutral-300">{{ e.target_id }}</span>
              <span v-if="!e.target_type && !e.target_id" class="text-neutral-400 dark:text-neutral-600">—</span>
            </td>
            <td class="px-4 py-2 text-xs text-neutral-600 dark:text-neutral-400">
              {{ e.user_email ?? '—' }}
            </td>
          </tr>
          <tr v-if="!loading && filtered.length === 0">
            <td colspan="5" class="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
              No entries.
            </td>
          </tr>
          <tr v-if="loading && session.auditLog.length === 0">
            <td colspan="5" class="px-4 py-10">
              <Spinner block />
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Pagination -->
    <div
      v-if="session.auditLogTotal > 0"
      class="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-neutral-600 dark:text-neutral-400"
    >
      <div>
        Showing <span class="font-medium text-neutral-900 dark:text-neutral-100">{{ rangeStart }}–{{ rangeEnd }}</span>
        of <span class="font-medium text-neutral-900 dark:text-neutral-100">{{ session.auditLogTotal }}</span>
      </div>

      <nav class="flex items-center gap-1">
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-neutral-700 dark:hover:bg-neutral-800"
          :disabled="loading || session.auditLogPage <= 1"
          @click="goto(session.auditLogPage - 1)"
        >‹ Prev</button>

        <template v-for="(p, i) in pageItems" :key="i">
          <span
            v-if="p === '…'"
            class="px-2 py-1 text-neutral-400 dark:text-neutral-600"
          >…</span>
          <button
            v-else
            type="button"
            class="min-w-[2rem] rounded-md px-2 py-1"
            :class="p === session.auditLogPage
              ? 'bg-accent-600 text-white font-semibold'
              : 'border border-neutral-300 hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'"
            :disabled="loading || p === session.auditLogPage"
            @click="goto(p)"
          >{{ p }}</button>
        </template>

        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-100 disabled:opacity-40 disabled:cursor-not-allowed dark:border-neutral-700 dark:hover:bg-neutral-800"
          :disabled="loading || session.auditLogPage >= session.auditLogPageCount"
          @click="goto(session.auditLogPage + 1)"
        >Next ›</button>
      </nav>
    </div>
  </main>
</template>
