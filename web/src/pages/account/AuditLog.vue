<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useSessionStore } from '../../stores/session';
import Dropdown from '../../components/Dropdown.vue';
import DatePicker from '../../components/DatePicker.vue';
import Spinner from '../../components/Spinner.vue';

const session = useSessionStore();
const loading = ref(false);

// ─── Filters (server-side) ────────────────────────────────────────────────────
const filters = reactive({ action: '', project: '', user: '', from: '', to: '' });

// Action is filtered by category (the entity prefix before the dot).
const actionOptions = [
  { value: 'user', label: 'Users' },
  { value: 'project', label: 'Projects' },
  { value: 'dashboard', label: 'Dashboards' },
  { value: 'variable', label: 'Variables' },
  { value: 'automation', label: 'Automations' },
  { value: 'integration', label: 'Integrations' },
  { value: 'token', label: 'Tokens' },
  { value: 'invite', label: 'Invites' },
  { value: 'session', label: 'Sessions' },
  { value: 'audit_log', label: 'Audit log' },
];
const projectOptions = computed(() => [
  { value: 'none', label: 'No project' },
  ...session.projects.map((p) => ({ value: p.id, label: p.name })),
]);
const userOptions = computed(() => [
  { value: 'system', label: 'System' },
  ...session.instanceUsers.map((u) => ({
    value: u.id,
    label: [u.first_name, u.last_name].filter(Boolean).join(' ') || u.email,
  })),
]);

const hasFilters = computed(
  () => !!(filters.action || filters.project || filters.user || filters.from || filters.to)
);

// No future audit entries — cap both pickers at today, and couple the range.
const now = new Date();
const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

function queryFilters() {
  const f: { action?: string; project?: string; user?: string; from?: number; to?: number } = {};
  if (filters.action) f.action = filters.action;
  if (filters.project) f.project = filters.project;
  if (filters.user) f.user = filters.user;
  if (filters.from) f.from = Math.floor(new Date(`${filters.from}T00:00:00`).getTime() / 1000);
  if (filters.to) f.to = Math.floor(new Date(`${filters.to}T23:59:59`).getTime() / 1000);
  return f;
}

async function load(page: number) {
  loading.value = true;
  try { await session.loadAuditLog(page, queryFilters()); } finally { loading.value = false; }
}

function clearFilters() {
  filters.action = '';
  filters.project = '';
  filters.user = '';
  filters.from = '';
  filters.to = '';
}

onMounted(async () => {
  // Users power the actor filter (owner-only page).
  try { await session.loadUsers(); } catch { /* ignore */ }
  await load(1);
});

// Any filter change → reload from page 1.
watch(filters, () => load(1));

async function goto(page: number) {
  if (page < 1 || page > session.auditLogPageCount) return;
  await load(page);
}

function fmt(ts: number): string {
  return new Date(ts * 1000).toLocaleString();
}

function actionTone(action: string): string {
  if (action === 'user.register') return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800';
  if (action === 'user.login')    return 'bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-900/30 dark:text-sky-300 dark:ring-sky-800';
  if (action === 'user.logout')   return 'bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700';
  if (action.endsWith('.delete') || action.endsWith('.remove')) return 'bg-red-50 text-red-700 ring-red-200 dark:bg-red-900/30 dark:text-red-300 dark:ring-red-800';
  if (action.endsWith('.create')) return 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-800';
  if (action.endsWith('.enable') || action.endsWith('.disable'))
    return 'bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-900/30 dark:text-amber-300 dark:ring-amber-800';
  if (action.endsWith('.update')) return 'bg-blue-50 text-blue-700 ring-blue-200 dark:bg-blue-900/30 dark:text-blue-300 dark:ring-blue-800';
  if (action.endsWith('.revoke')) return 'bg-accent-50 text-accent-700 ring-accent-200 dark:bg-accent-900/30 dark:text-accent-300 dark:ring-accent-800';
  return 'bg-neutral-100 text-neutral-700 ring-neutral-200 dark:bg-neutral-800 dark:text-neutral-300 dark:ring-neutral-700';
}

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
        Append-only record of changes across the whole deployment, by users and the system. Newest first.
      </p>
    </header>

    <!-- Filters -->
    <div class="mb-4 flex flex-wrap items-end gap-2">
      <label class="block">
        <span class="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Action</span>
        <Dropdown v-model="filters.action" :options="actionOptions" placeholder="All actions" size="sm" class="mt-1 w-40" />
      </label>
      <label class="block">
        <span class="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400">Project</span>
        <Dropdown v-model="filters.project" :options="projectOptions" placeholder="All projects" size="sm" class="mt-1 w-44" />
      </label>
      <label class="block">
        <span class="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400">User</span>
        <Dropdown v-model="filters.user" :options="userOptions" placeholder="All users" size="sm" class="mt-1 w-44" />
      </label>
      <label class="block">
        <span class="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400">From</span>
        <DatePicker v-model="filters.from" placeholder="Any date" :max="filters.to || todayISO" class="mt-1 w-40" />
      </label>
      <label class="block">
        <span class="block text-[11px] font-medium text-neutral-500 dark:text-neutral-400">To</span>
        <DatePicker v-model="filters.to" placeholder="Any date" :min="filters.from" :max="todayISO" class="mt-1 w-40" />
      </label>
      <button
        v-if="hasFilters"
        type="button"
        class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
        @click="clearFilters"
      >Clear</button>
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
          <tr v-for="e in session.auditLog" :key="e.id" class="hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
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
            <td class="px-4 py-2 text-xs">
              <span v-if="e.user_email" class="text-neutral-600 dark:text-neutral-400">{{ e.user_email }}</span>
              <span v-else class="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400">System</span>
            </td>
          </tr>
          <tr v-if="!loading && session.auditLog.length === 0">
            <td colspan="5" class="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
              <template v-if="hasFilters">No entries match these filters.</template>
              <template v-else>
                No entries. Audit logging is off by default — an owner can enable it in
                <RouterLink to="/settings" class="text-accent-700 hover:underline dark:text-accent-400">Settings → More</RouterLink>.
              </template>
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
