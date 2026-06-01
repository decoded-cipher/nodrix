<script setup lang="ts">
import { nextTick, ref } from 'vue';
import { useProjectStore } from '../../../stores/project';
import Combobox from '../../../components/Combobox.vue';
import { confirm } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import { relativeTime, formatAbsolute } from '../../../lib/time';
import type { Variable } from '../../../types';

// Common telemetry units suggested in the unit combobox; any custom value works.
const UNIT_OPTIONS = [
  '°C', '°F', 'K', '%', 'µg/m³', 'mg/m³', 'ppm', 'ppb',
  'Pa', 'hPa', 'kPa', 'bar', 'psi', 'V', 'mV', 'A', 'mA', 'W', 'kW', 'Wh', 'kWh',
  'Hz', 'rpm', 'lux', 'dB', 'm', 'cm', 'mm', 'km', 'm/s', 'km/h',
  'L', 'mL', 'm³', 'g', 'kg', 's', 'min', 'h',
];

const project = useProjectStore();

// ── Add a variable (persistent create row) ────────────────────────────────────
const newKey = ref('');
const newUnit = ref('');
const creating = ref(false);
const newKeyEl = ref<HTMLInputElement | null>(null);

async function createVariable() {
  const key = newKey.value.trim();
  if (!key) return;
  creating.value = true;
  try {
    await project.createVariable({ key, unit: newUnit.value.trim() || null });
    newKey.value = '';
    newUnit.value = '';
    await nextTick();
    newKeyEl.value?.focus();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    creating.value = false;
  }
}

// ── Inline unit editing ───────────────────────────────────────────────────────
// Toggled by the per-row edit (pencil) button. Only one row edits at a time;
// Enter saves, Esc cancels.
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
</script>

<template>
  <div>
    <!-- Create a variable -->
    <form
      class="mb-6 flex flex-col gap-2 rounded-lg border border-neutral-200 bg-white p-3 sm:flex-row dark:border-neutral-800 dark:bg-neutral-900"
      @submit.prevent="createVariable"
    >
      <input
        ref="newKeyEl"
        v-model="newKey"
        type="text"
        placeholder="New variable key (e.g. pm25)"
        class="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 font-mono text-sm focus:border-accent-500 focus:outline-none dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <input
        v-model="newUnit"
        type="text"
        placeholder="Unit (optional)"
        class="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none sm:w-40 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
      />
      <button
        type="submit"
        :disabled="creating || !newKey.trim()"
        class="shrink-0 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
      >Add variable</button>
    </form>

    <!-- Variables table -->
    <div class="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
      <table v-if="project.variables.length > 0" class="w-full text-left text-sm">
        <thead class="border-b border-neutral-100 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
          <tr>
            <th class="px-4 py-2.5 font-medium">Key</th>
            <th class="px-4 py-2.5 font-medium">Unit</th>
            <th class="hidden px-4 py-2.5 font-medium sm:table-cell">Last seen</th>
            <th class="px-4 py-2.5"><span class="sr-only">Actions</span></th>
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
            <td class="hidden px-4 py-2.5 text-xs text-neutral-500 sm:table-cell dark:text-neutral-400">
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

      <!-- Empty state -->
      <div v-else class="px-4 py-12 text-center">
        <p class="text-sm font-medium text-neutral-700 dark:text-neutral-300">No variables yet</p>
        <p class="mx-auto mt-1 max-w-sm text-xs text-neutral-500 dark:text-neutral-400">
          Keys appear automatically the first time hardware posts to them — or add one above.
        </p>
      </div>
    </div>
  </div>
</template>
