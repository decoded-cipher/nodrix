<script setup lang="ts">
import { computed, ref } from 'vue';
import { RouterLink } from 'vue-router';
import { useProjectStore } from '../../../stores/project';
import { confirm } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import { relativeTime, formatAbsolute } from '../../../lib/time';
import Dropdown from '../../../components/Dropdown.vue';
import type { Device } from '../../../types';

const project = useProjectStore();

const editingId = ref<string | null>(null);
const draftName = ref('');

const firmwareTab = computed(() => `/p/${project.currentProjectId ?? ''}/device/firmware`);

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

const firmwareOptions = computed(() =>
  project.firmware.map((f) => ({
    value: f.id,
    label: f.version,
    hint: relativeTime(f.created_at),
  }))
);

async function assign(deviceId: string, firmwareId: string) {
  try {
    await project.assignFirmware(deviceId, firmwareId || null);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

function otaState(d: Device): { text: string; failed: boolean } | null {
  if (!d.desired_firmware_id || d.ota_status === 'ok') return null;
  if (d.ota_status === 'failed') {
    return { text: 'gave up — the board never reported this version', failed: true };
  }
  return { text: online(d.last_seen) ? 'waiting for the board' : 'queued until it reports', failed: false };
}

const otaStates = computed<Record<string, { text: string; failed: boolean } | null>>(() =>
  Object.fromEntries(project.devices.map((d) => [d.id, otaState(d)]))
);

// Assigning the same image again is the retry: the server clears the attempt count.
async function retry(d: Device) {
  if (!d.desired_firmware_id) return;
  try {
    await project.assignFirmware(d.id, d.desired_firmware_id);
    toast.success('Offering the update again.');
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function forget(id: string, name: string) {
  const ok = await confirm({
    title: `Forget ${name}?`,
    message: 'Its variables and recent history go with it.',
    details: [
      'Telemetry already archived is kept.',
      'A dashboard reading this device needs one picked again.',
      'The board reappears here if it reports again, as a new device.',
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
  <div class="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
    <table class="w-full text-sm">
      <thead class="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
        <tr>
          <th class="px-4 py-2.5 font-medium">Device</th>
          <th class="px-4 py-2.5 font-medium">Chip</th>
          <th class="px-4 py-2.5 font-medium">Running</th>
          <th class="px-4 py-2.5 font-medium">Update to</th>
          <th class="px-4 py-2.5 font-medium">Last seen</th>
          <th class="px-4 py-2.5" />
        </tr>
      </thead>
      <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
        <tr
          v-for="d in project.devices"
          :key="d.id"
          class="group align-top hover:bg-neutral-50 dark:hover:bg-neutral-800/50"
        >
          <td class="px-4 py-3">
            <input
              v-if="editingId === d.id"
              :ref="(el) => focusName(el as Element | null)"
              v-model="draftName"
              class="w-full rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
              @keyup.enter="saveName(d.id)"
              @keyup.esc="editingId = null"
              @blur="saveName(d.id)"
            />
            <template v-else>
              <span class="inline-flex items-center gap-2 font-medium">
                <span
                  class="h-1.5 w-1.5 shrink-0 rounded-full"
                  :class="online(d.last_seen) ? 'bg-emerald-500' : 'bg-neutral-300 dark:bg-neutral-600'"
                  :title="online(d.last_seen) ? 'Reporting' : 'Not reporting'"
                />
                {{ d.name }}
                <span
                  v-if="d.is_default"
                  class="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-normal text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
                >default</span>
              </span>
            </template>
          </td>
          <td class="px-4 py-3 text-neutral-600 dark:text-neutral-400">{{ d.chip ?? '—' }}</td>
          <td class="px-4 py-3 font-mono text-xs text-neutral-600 dark:text-neutral-400">
            {{ d.firmware_version ?? '—' }}
          </td>
          <td class="px-4 py-3">
            <RouterLink
              v-if="!project.firmware.length"
              :to="firmwareTab"
              class="text-xs font-medium text-accent-700 hover:underline dark:text-accent-400"
            >Upload firmware first</RouterLink>
            <template v-else>
              <Dropdown
                :model-value="d.desired_firmware_id ?? ''"
                :options="firmwareOptions"
                placeholder="Nothing pending"
                size="sm"
                class="max-w-[13rem]"
                @update:model-value="(v) => assign(d.id, String(v))"
              />
              <p
                v-if="otaStates[d.id]"
                class="mt-1 text-[11px]"
                :class="otaStates[d.id]?.failed ? 'text-amber-700 dark:text-amber-500' : 'text-neutral-500'"
              >
                {{ otaStates[d.id]?.text }}
                <button
                  v-if="otaStates[d.id]?.failed"
                  type="button"
                  class="ml-1 font-medium underline hover:no-underline"
                  @click="retry(d)"
                >Try again</button>
              </p>
            </template>
          </td>
          <td class="px-4 py-3 text-neutral-600 dark:text-neutral-400" :title="d.last_seen ? formatAbsolute(d.last_seen) : ''">
            {{ d.last_seen ? relativeTime(d.last_seen) : 'Never' }}
          </td>
          <td class="whitespace-nowrap px-4 py-3">
            <div class="flex items-center justify-end gap-1">
              <button
                type="button"
                aria-label="Rename device"
                title="Rename device"
                class="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                @click="startEdit(d.id, d.name)"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button
                v-if="!d.is_default"
                type="button"
                aria-label="Forget device"
                title="Forget device"
                class="rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                @click="forget(d.id, d.name)"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              </button>
              <span v-else class="h-7 w-7" aria-hidden="true" />
            </div>
          </td>
        </tr>
        <tr v-if="!project.devices.length">
          <td colspan="6" class="px-4 py-10 text-center text-sm text-neutral-500">
            No devices yet. A board appears here the first time it reports.
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
