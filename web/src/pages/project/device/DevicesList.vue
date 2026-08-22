<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useProjectStore } from '../../../stores/project';
import { confirm } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import { relativeTime, formatAbsolute } from '../../../lib/time';
import Spinner from '../../../components/Spinner.vue';

const project = useProjectStore();
const loading = ref(true);

onMounted(async () => {
  try {
    await Promise.all([project.loadDevices(), project.loadFirmware()]);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
});

const editingId = ref<string | null>(null);
const draftName = ref('');

function startEdit(id: string, name: string) {
  editingId.value = id;
  draftName.value = name;
}

// Derived: a device that stops reporting never writes, so no stored flag would flip.
const OFFLINE_AFTER_SECONDS = 5 * 60;

function online(lastSeen: number | null): boolean {
  return !!lastSeen && Math.floor(Date.now() / 1000) - lastSeen < OFFLINE_AFTER_SECONDS;
}

// A template ref inside v-for collects into an array, so focus on mount instead.
function focusName(el: Element | null) {
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
  }
}

async function saveName(id: string) {
  const name = draftName.value.trim();
  if (!name) return;
  try {
    await project.renameDevice(id, name);
    editingId.value = null;
  } catch (e) {
    toast.error((e as Error).message);
  }
}

// Build ids are the version, so a saved build needs a human-sized handle.
function buildLabel(f: { version: string; created_at: number }): string {
  return `${f.version.replace(/^bld_/, '').slice(0, 6)} · ${relativeTime(f.created_at)}`;
}

async function assign(deviceId: string, firmwareId: string) {
  try {
    await project.assignFirmware(deviceId, firmwareId || null);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

function otaState(d: { desired_firmware_id: string | null; ota_status: string | null }): string {
  if (!d.desired_firmware_id) return '';
  return d.ota_status === 'ok' ? '' : 'waiting for the board';
}

async function forget(id: string, name: string) {
  const ok = await confirm({
    title: `Forget ${name}?`,
    message: 'Its variables and recent history go with it.',
    details: [
      'Telemetry already archived is kept.',
      'The board reappears here if it reports again.',
    ],
    confirmLabel: 'Forget',
  });
  if (!ok) return;
  try {
    await project.forgetDevice(id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div v-if="loading" class="flex justify-center py-10">
    <Spinner size="sm" label="Loading devices…" />
  </div>

  <div v-else class="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
    <table class="w-full text-sm">
      <thead class="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
        <tr>
          <th class="px-4 py-2.5 font-medium">Name</th>
          <th class="px-4 py-2.5 font-medium">Chip</th>
          <th class="px-4 py-2.5 font-medium">Running</th>
          <th class="px-4 py-2.5 font-medium">Update to</th>
          <th class="px-4 py-2.5 font-medium">Last seen</th>
          <th class="px-4 py-2.5" />
        </tr>
      </thead>
      <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
        <tr v-for="d in project.devices" :key="d.id">
          <td class="px-4 py-2.5">
            <input
              v-if="editingId === d.id"
              :ref="(el) => focusName(el as Element | null)"
              v-model="draftName"
              class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              @keyup.enter="saveName(d.id)"
              @keyup.esc="editingId = null"
              @blur="saveName(d.id)"
            />
            <span v-else class="inline-flex items-center gap-2 font-medium">
              <span
                class="h-1.5 w-1.5 shrink-0 rounded-full"
                :class="online(d.last_seen) ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-600'"
                :title="online(d.last_seen) ? 'Reporting' : 'Not reporting'"
              />
              {{ d.name }}
            </span>
            <span
              v-if="d.is_default && editingId !== d.id"
              class="ml-2 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            >default</span>
          </td>
          <td class="px-4 py-2.5 text-neutral-600 dark:text-neutral-400">{{ d.chip ?? '—' }}</td>
          <td class="px-4 py-2.5 text-neutral-600 dark:text-neutral-400">
            {{ d.firmware_version ? d.firmware_version.replace(/^bld_/, '').slice(0, 6) : '—' }}
          </td>
          <td class="px-4 py-2.5">
            <select
              :value="d.desired_firmware_id ?? ''"
              class="w-full max-w-[13rem] rounded-md border border-neutral-300 bg-white px-2 py-1 text-xs dark:border-neutral-700 dark:bg-neutral-950"
              @change="assign(d.id, ($event.target as HTMLSelectElement).value)"
            >
              <option value="">Nothing pending</option>
              <option v-for="f in project.firmware" :key="f.id" :value="f.id">{{ buildLabel(f) }}</option>
            </select>
            <span v-if="otaState(d)" class="mt-1 block text-[10px] text-neutral-500">{{ otaState(d) }}</span>
          </td>
          <td class="px-4 py-2.5 text-neutral-600 dark:text-neutral-400" :title="d.last_seen ? formatAbsolute(d.last_seen) : ''">
            {{ d.last_seen ? relativeTime(d.last_seen) : 'Never' }}
          </td>
          <td class="px-4 py-2.5 text-right">
            <button
              type="button"
              class="text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100"
              @click="startEdit(d.id, d.name)"
            >Rename</button>
            <button
              v-if="!d.is_default"
              type="button"
              class="ml-3 text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400"
              @click="forget(d.id, d.name)"
            >Forget</button>
          </td>
        </tr>
        <tr v-if="!project.devices.length">
          <td colspan="6" class="px-4 py-8 text-center text-sm text-neutral-500">
            No devices yet. A board appears here the first time it reports.
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
