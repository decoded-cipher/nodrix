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
const draftFirmware = ref('');
const saving = ref(false);

const proj = computed(() => project.currentProjectId ?? '');
const firmwareTab = computed(() => `/p/${proj.value}/device/firmware`);
const tokensPage = computed(() => `/p/${proj.value}/variables/tokens`);
const host = window.location.host;

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

function family(chip: string | null): string | null {
  const c = chip?.toLowerCase();
  if (!c) return null;
  const m = c.match(/^esp32-(s2|s3|c2|c3|c5|c6|h2|p4)/);
  if (m) return `ESP32-${m[1]!.toUpperCase()}`;
  if (c.startsWith('esp32')) return 'ESP32';
  if (c.startsWith('esp8266')) return 'ESP8266';
  return null;
}

const units = computed(() => Object.fromEntries(project.variables.map((v) => [v.key, v.unit ?? ''])));

function show(value: unknown): string {
  if (typeof value === 'boolean') return value ? 'on' : 'off';
  if (typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (value === null || value === undefined) return '—';
  const s = typeof value === 'string' ? value : JSON.stringify(value);
  return s.length > 16 ? `${s.slice(0, 15)}…` : s;
}

function readings(d: Device): string {
  const vars = Object.entries(project.deviceState[d.id] ?? {}).sort((a, b) => b[1].received_at - a[1].received_at);
  return vars
    .slice(0, 3)
    .map(([k, r]) => `${k} ${show(r.value)}${units.value[k] ? ` ${units.value[k]}` : ''}`)
    .join(' · ');
}

const versionById = computed(() => Object.fromEntries(project.firmware.map((f) => [f.id, f.version])));

type Tone = 'ok' | 'busy' | 'idle' | 'failed';
function updateState(d: Device): { tone: Tone; text: string } | null {
  const v = d.desired_firmware_id ? versionById.value[d.desired_firmware_id] : null;
  if (!v) return null;
  if (d.ota_status === 'failed') return { tone: 'failed', text: `${v} didn't take` };
  if (d.ota_status === 'ok' || v === d.firmware_version) return null;
  return liveness(d.last_seen) === 'live'
    ? { tone: 'busy', text: `updating to ${v}` }
    : { tone: 'idle', text: `${v} when back online` };
}
const TONE: Record<Tone, string> = {
  ok: 'text-emerald-700 dark:text-emerald-400',
  busy: 'text-accent-700 dark:text-accent-400',
  idle: 'text-neutral-500 dark:text-neutral-400',
  failed: 'text-amber-700 dark:text-amber-500',
};

function firmwareOptions(d: Device) {
  return project.firmware.map((f, i) => ({
    value: f.id,
    label: f.version,
    meta: f.version === d.firmware_version ? 'running' : i === 0 ? 'latest' : undefined,
    hint: `${f.target ?? 'any chip'} · ${relativeTime(f.created_at)}`,
  }));
}

function startEdit(d: Device) {
  editingId.value = d.id;
  draftName.value = d.name;
  draftFirmware.value = d.desired_firmware_id ?? '';
}

function cancelEdit() {
  editingId.value = null;
}

// A template ref inside v-for collects into an array, so focus on mount instead.
function focusName(el: Element | null) {
  if (el instanceof HTMLInputElement) {
    el.focus();
    el.select();
  }
}

async function saveEdit(d: Device) {
  const name = draftName.value.trim();
  if (!name || saving.value) return;
  saving.value = true;
  try {
    if (name !== d.name) await project.renameDevice(d.id, name);
    if (draftFirmware.value !== (d.desired_firmware_id ?? '')) {
      await project.assignFirmware(d.id, draftFirmware.value || null);
    }
    editingId.value = null;
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    saving.value = false;
  }
}

async function retry(d: Device) {
  if (!d.desired_firmware_id) return;
  try {
    await project.assignFirmware(d.id, d.desired_firmware_id);
    toast.success('Offering the update again.');
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function forget(d: Device) {
  const ok = await confirm({
    title: `Forget ${d.name}?`,
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
    await project.forgetDevice(d.id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div class="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
    <table v-if="project.listedDevices.length" class="w-full text-left text-sm">
      <thead class="border-b border-neutral-100 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
        <tr>
          <th class="px-4 py-2.5 font-medium">Device</th>
          <th class="px-4 py-2.5 font-medium">Firmware</th>
          <th class="hidden px-4 py-2.5 font-medium md:table-cell">Last seen</th>
          <th class="px-4 py-2.5 font-medium">Update to</th>
          <th class="px-4 py-2.5"><span class="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody class="divide-y divide-neutral-100 dark:divide-neutral-800">
        <tr v-for="d in project.listedDevices" :key="d.id" class="group hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
          <td class="px-4 py-2.5">
            <div class="flex min-w-0 items-center gap-2.5">
              <span
                class="h-2 w-2 shrink-0 rounded-full"
                :class="DOT[liveness(d.last_seen)]"
                :title="d.last_seen ? `Last seen ${formatAbsolute(d.last_seen)}` : 'Never seen'"
              />
              <div class="min-w-0">
                <input
                  v-if="editingId === d.id"
                  :ref="(el) => focusName(el as Element | null)"
                  v-model="draftName"
                  class="w-full max-w-[14rem] rounded-md border border-neutral-300 bg-white px-2 py-0.5 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
                  @keyup.enter="saveEdit(d)"
                  @keyup.esc="cancelEdit"
                />
                <div v-else class="flex items-center gap-1.5">
                  <span class="truncate font-medium">{{ d.name }}</span>
                  <span
                    v-if="family(d.chip)"
                    class="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                    :title="d.chip ?? ''"
                  >{{ family(d.chip) }}</span>
                  <span
                    v-if="d.is_default"
                    class="shrink-0 rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                    title="Requests that don't name a device land here"
                  >Default</span>
                </div>
                <p class="truncate text-xs text-neutral-500 dark:text-neutral-400">
                  {{ readings(d) || `${d.variables} ${d.variables === 1 ? 'variable' : 'variables'}` }}
                </p>
              </div>
            </div>
          </td>
          <td class="px-4 py-2.5">
            <span v-if="d.firmware_version" class="font-mono text-xs">{{ d.firmware_version }}</span>
            <span v-else class="text-xs italic text-neutral-400 dark:text-neutral-600" title="The sketch doesn't call setFirmwareVersion()">—</span>
            <p v-if="updateState(d)" class="truncate text-xs" :class="TONE[updateState(d)!.tone]">
              {{ updateState(d)!.text }}
              <button
                v-if="updateState(d)!.tone === 'failed'"
                type="button"
                class="ml-1 font-medium underline hover:no-underline"
                @click="retry(d)"
              >Retry</button>
            </p>
          </td>
          <td class="hidden px-4 py-2.5 text-xs text-neutral-500 md:table-cell dark:text-neutral-400">
            <span v-if="d.last_seen" :title="formatAbsolute(d.last_seen)">{{ relativeTime(d.last_seen) }}</span>
            <span v-else class="italic text-neutral-400 dark:text-neutral-600">Never</span>
          </td>
          <td class="px-4 py-2.5">
            <Dropdown
              v-if="editingId === d.id && project.firmware.length"
              v-model="draftFirmware"
              :options="firmwareOptions(d)"
              placeholder="No update"
              size="sm"
              class="w-36"
            />
            <RouterLink
              v-else-if="editingId === d.id"
              :to="firmwareTab"
              class="text-xs font-medium text-accent-700 hover:underline dark:text-accent-400"
            >Upload firmware first</RouterLink>
            <span v-else-if="d.desired_firmware_id" class="font-mono text-xs">{{ versionById[d.desired_firmware_id] ?? '—' }}</span>
            <span v-else class="text-xs text-neutral-400 dark:text-neutral-600">—</span>
          </td>
          <td class="px-4 py-2.5">
            <div class="flex items-center justify-end gap-1">
              <template v-if="editingId === d.id">
                <button
                  type="button"
                  aria-label="Save"
                  title="Save"
                  :disabled="saving || !draftName.trim()"
                  class="rounded-md p-1.5 text-emerald-600 hover:bg-emerald-50 disabled:opacity-50 dark:text-emerald-400 dark:hover:bg-emerald-950/40"
                  @click="saveEdit(d)"
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
                aria-label="Edit device"
                title="Edit device"
                class="rounded-md p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
                @click="startEdit(d)"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              <button
                v-if="!d.is_default"
                type="button"
                aria-label="Forget device"
                title="Forget device"
                class="rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                @click="forget(d)"
              >
                <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
              </button>
              <span v-else class="h-7 w-7" aria-hidden="true" />
              </template>
            </div>
          </td>
        </tr>
      </tbody>
    </table>

    <div v-else class="px-4 py-12 text-center">
      <p class="text-sm font-medium text-neutral-700 dark:text-neutral-300">No devices yet</p>
      <p class="mx-auto mt-1 max-w-sm text-xs text-neutral-500 dark:text-neutral-400">
        A board appears here the first time it connects —
        <span class="font-mono">Nodrix.begin(…, "{{ host }}", TOKEN)</span>. Get a token from
        <RouterLink :to="tokensPage" class="font-medium text-accent-700 hover:underline dark:text-accent-400">Connection tokens</RouterLink>.
      </p>
    </div>
  </div>
</template>
