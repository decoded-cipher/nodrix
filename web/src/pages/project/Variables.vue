<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue';
import { useProjectStore } from '../../stores/project';
import RevealOnce from '../../components/RevealOnce.vue';
import Combobox from '../../components/Combobox.vue';
import { confirm } from '../../lib/confirm';
import { toast } from '../../lib/toast';
import { relativeTime, formatAbsolute } from '../../lib/time';
import type { ProjectTokenWithSecret, Variable } from '../../types';

// Common telemetry units suggested in the unit combobox; any custom value works.
const UNIT_OPTIONS = [
  '°C', '°F', 'K', '%', 'µg/m³', 'mg/m³', 'ppm', 'ppb',
  'Pa', 'hPa', 'kPa', 'bar', 'psi', 'V', 'mV', 'A', 'mA', 'W', 'kW', 'Wh', 'kWh',
  'Hz', 'rpm', 'lux', 'dB', 'm', 'cm', 'mm', 'km', 'm/s', 'km/h',
  'L', 'mL', 'm³', 'g', 'kg', 's', 'min', 'h',
];

const project = useProjectStore();
const newKey = ref('');
const newUnit = ref('');
const creating = ref(false);
const justCreatedToken = ref<ProjectTokenWithSecret | null>(null);
const creatingToken = ref(false);

onMounted(() => {
  project.loadVariables();
  project.loadProjectTokens();
});

async function createVariable() {
  const key = newKey.value.trim();
  if (!key) return;
  creating.value = true;
  try {
    await project.createVariable({ key, unit: newUnit.value.trim() || null });
    newKey.value = '';
    newUnit.value = '';
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    creating.value = false;
  }
}

// Inline unit editing, toggled by the per-row edit (pencil) button. Only one
// row edits at a time; Enter saves, Esc cancels.
const editingId = ref<string | null>(null);
const editValue = ref('');
const comboRef = ref<{ focus: () => void } | null>(null);

async function startEdit(v: Variable) {
  editingId.value = v.id;
  editValue.value = v.unit ?? '';
  await nextTick();
  comboRef.value?.focus();
}

function cancelEdit() {
  editingId.value = null;
  editValue.value = '';
}

async function saveEdit(v: Variable) {
  const next = editValue.value.trim() || null;
  editingId.value = null;
  if (next === (v.unit ?? null)) return; // unchanged
  try {
    await project.updateVariable(v.id, { unit: next });
  } catch (err) {
    toast.error((err as Error).message);
  }
}

async function removeVariable(id: string) {
  const v = project.variables.find((x) => x.id === id);
  const key = v?.key ?? id;
  const ok = await confirm({
    title: `Delete variable "${key}"?`,
    message: 'This action cannot be undone.',
    details: [
      'Latest value and recent history are wiped',
      'Widgets bound to this variable stop updating',
      'It will re-appear if hardware posts to this key again',
    ],
    confirmLabel: 'Delete variable',
  });
  if (!ok) return;
  try {
    await project.deleteVariable(id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// Liveness from last telemetry: green < 5m, amber < 1d, grey older, hollow never.
type Liveness = 'live' | 'recent' | 'stale' | 'never';
function liveness(lastSeen: number | null): Liveness {
  if (!lastSeen) return 'never';
  const age = Date.now() / 1000 - lastSeen;
  if (age < 300) return 'live';
  if (age < 86_400) return 'recent';
  return 'stale';
}
const DOT: Record<Liveness, string> = {
  live: 'bg-emerald-500',
  recent: 'bg-amber-400',
  stale: 'bg-neutral-300 dark:bg-neutral-600',
  never: 'border border-neutral-300 dark:border-neutral-600',
};

async function createToken() {
  creatingToken.value = true;
  try {
    justCreatedToken.value = await project.createProjectToken(null);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    creatingToken.value = false;
  }
}

async function revokeToken(id: string) {
  const ok = await confirm({
    title: 'Revoke this connection token?',
    message: 'Any hardware using it will stop being able to post telemetry immediately.',
    confirmLabel: 'Revoke token',
  });
  if (!ok) return;
  try {
    await project.revokeProjectToken(id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

function fmt(ts: number | null | undefined): string {
  return ts ? new Date(ts * 1000).toLocaleString() : '—';
}

const variableCount = computed(() => project.variables.length);
</script>

<template>
  <main class="mx-auto max-w-4xl px-6 py-8">
    <h2 class="text-xl font-semibold tracking-tight">Variables</h2>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      Project-scoped data points. New keys appear automatically the first time hardware posts to them.
    </p>

    <!-- Add a variable -->
    <form class="mt-6 flex flex-col gap-2 sm:flex-row" @submit.prevent="createVariable">
      <input
        v-model="newKey"
        type="text"
        placeholder="New variable key (e.g. pm25)"
        class="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <input
        v-model="newUnit"
        type="text"
        placeholder="Unit (optional)"
        class="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm sm:w-36 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <button
        type="submit"
        :disabled="creating || !newKey.trim()"
        class="shrink-0 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
      >Add variable</button>
    </form>

    <!-- Variables table -->
    <div class="mt-6 overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <div class="flex items-center justify-between border-b border-neutral-100 px-4 py-2.5 dark:border-neutral-800">
        <span class="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
          {{ variableCount }} {{ variableCount === 1 ? 'variable' : 'variables' }}
        </span>
      </div>
      <table v-if="project.variables.length > 0" class="w-full text-left text-sm">
        <thead class="border-b border-neutral-100 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
          <tr>
            <th class="px-4 py-2 font-medium">Key</th>
            <th class="px-4 py-2 font-medium">Unit</th>
            <th class="px-4 py-2 font-medium">Last seen</th>
            <th class="px-4 py-2"><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody class="divide-y divide-neutral-100 dark:divide-neutral-800">
          <tr v-for="v in project.variables" :key="v.id" class="group hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
            <td class="px-4 py-2.5">
              <div class="flex items-center gap-2.5">
                <span
                  class="h-2 w-2 shrink-0 rounded-full"
                  :class="DOT[liveness(v.last_seen)]"
                  :title="v.last_seen ? `Last seen ${formatAbsolute(v.last_seen)}` : 'Never seen'"
                />
                <span class="font-mono text-sm font-medium">{{ v.key }}</span>
              </div>
            </td>
            <td class="px-4 py-2.5">
              <Combobox
                v-if="editingId === v.id"
                ref="comboRef"
                v-model="editValue"
                :options="UNIT_OPTIONS"
                class="w-28"
                @commit="saveEdit(v)"
                @cancel="cancelEdit"
              />
              <span v-else class="text-xs text-neutral-600 dark:text-neutral-300">
                {{ v.unit || '—' }}
              </span>
            </td>
            <td class="px-4 py-2.5 text-xs text-neutral-500 dark:text-neutral-400">
              <span v-if="v.last_seen" :title="formatAbsolute(v.last_seen)">{{ relativeTime(v.last_seen) }}</span>
              <span v-else class="italic text-neutral-400 dark:text-neutral-600">Never</span>
            </td>
            <td class="px-4 py-2.5">
              <div class="flex items-center justify-end gap-1">
                <template v-if="editingId === v.id">
                  <button
                    type="button"
                    aria-label="Save unit"
                    title="Save"
                    class="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                    @click="saveEdit(v)"
                  >
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Cancel"
                    title="Cancel"
                    class="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                    @click="cancelEdit"
                  >
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 6L6 18"/><path d="M6 6l12 12"/></svg>
                  </button>
                </template>
                <template v-else>
                  <button
                    type="button"
                    aria-label="Edit unit"
                    title="Edit unit"
                    class="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                    @click="startEdit(v)"
                  >
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                  </button>
                  <button
                    type="button"
                    aria-label="Delete variable"
                    title="Delete variable"
                    class="rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    @click="removeVariable(v.id)"
                  >
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                  </button>
                </template>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
        No variables yet. Post telemetry or add one above.
      </div>
    </div>

    <!-- Connection tokens -->
    <h3 class="mt-10 text-lg font-semibold tracking-tight">Connection tokens</h3>
    <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
      Hardware authenticates with a project token to post telemetry and poll for control writes.
    </p>

    <RevealOnce
      v-if="justCreatedToken"
      :value="justCreatedToken.token"
      label="Project connection token"
      class="mt-4"
    />

    <div class="mt-4">
      <button
        type="button"
        :disabled="creatingToken"
        class="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
        @click="createToken"
      >Create token</button>
    </div>

    <ul class="mt-4 divide-y divide-neutral-200 rounded-lg border border-neutral-200 bg-white dark:divide-neutral-800 dark:border-neutral-800 dark:bg-neutral-900">
      <li v-for="t in project.projectTokens" :key="t.id" class="flex items-center justify-between gap-4 px-4 py-3">
        <div class="min-w-0 flex-1">
          <div class="font-mono text-xs text-neutral-500 dark:text-neutral-400">{{ t.id }}</div>
          <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            created {{ fmt(t.created_at) }} · last used {{ fmt(t.last_used_at) }}
          </div>
        </div>
        <div class="flex items-center gap-3 text-xs">
          <span v-if="t.revoked_at" class="rounded-full bg-neutral-200 px-2 py-0.5 uppercase tracking-wide text-neutral-600 dark:bg-neutral-700 dark:text-neutral-300">revoked</span>
          <button
            v-else
            class="rounded-md border border-red-300 px-3 py-1 text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
            @click="revokeToken(t.id)"
          >Revoke</button>
        </div>
      </li>
      <li v-if="project.projectTokens.length === 0" class="px-4 py-6 text-sm text-neutral-500 dark:text-neutral-400">
        No connection tokens yet.
      </li>
    </ul>
  </main>
</template>
