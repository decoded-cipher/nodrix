<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useProjectStore } from '../../../stores/project';
import { confirm } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import { relativeTime } from '../../../lib/time';
import Spinner from '../../../components/Spinner.vue';

const project = useProjectStore();
const loading = ref(true);

const version = ref('');
const notes = ref('');
const file = ref<File | null>(null);
const uploading = ref(false);

onMounted(async () => {
  try {
    await Promise.all([project.loadFirmware(), project.loadDevices()]);
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
});

function pick(e: Event) {
  file.value = (e.target as HTMLInputElement).files?.[0] ?? null;
}

async function upload() {
  if (!file.value || !version.value.trim()) return;
  uploading.value = true;
  try {
    await project.uploadFirmware({
      version: version.value.trim(),
      notes: notes.value.trim() || undefined,
      body: await file.value.arrayBuffer(),
    });
    version.value = '';
    notes.value = '';
    file.value = null;
    toast.success('Firmware uploaded');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    uploading.value = false;
  }
}

async function remove(id: string, v: string) {
  const ok = await confirm({
    title: `Delete ${v}?`,
    message: 'Any device set to update to it goes back to having nothing pending.',
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  try {
    await project.deleteFirmware(id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function assign(deviceId: string, firmwareId: string) {
  try {
    await project.assignFirmware(deviceId, firmwareId || null);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

function sizeKb(bytes: number) {
  return `${Math.round(bytes / 1024)} KB`;
}

function statusOf(d: { desired_firmware_id: string | null; ota_status: string | null; firmware_version: string | null }) {
  if (!d.desired_firmware_id) return d.firmware_version ?? 'unknown';
  if (d.ota_status === 'ok') return d.firmware_version ?? 'up to date';
  return 'waiting for the device';
}
</script>

<template>
  <div v-if="loading" class="flex justify-center py-10">
    <Spinner size="sm" label="Loading firmware…" />
  </div>

  <div v-else class="space-y-6">
    <div class="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <h2 class="text-sm font-semibold">Upload an image</h2>
      <div class="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
        <label class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Version</span>
          <input
            v-model="version"
            placeholder="1.4.0"
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>
        <label class="block">
          <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Notes</span>
          <input
            v-model="notes"
            placeholder="What changed"
            class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
        </label>
      </div>
      <input
        type="file"
        accept=".bin"
        class="mt-3 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm file:font-medium dark:file:bg-neutral-800 dark:file:text-neutral-200"
        @change="pick"
      />
      <button
        type="button"
        :disabled="!file || !version.trim() || uploading"
        class="mt-3 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
        @click="upload"
      >{{ uploading ? 'Uploading…' : 'Upload' }}</button>
      <p class="mt-2 text-xs text-neutral-500">
        The version must match what the sketch reports, or the device will never be marked updated.
      </p>
    </div>

    <div>
      <h2 class="mb-2 text-sm font-semibold">Images</h2>
      <div class="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table class="w-full text-sm">
          <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
            <tr v-for="f in project.firmware" :key="f.id">
              <td class="px-4 py-2.5 font-medium">{{ f.version }}</td>
              <td class="px-4 py-2.5 text-neutral-600 dark:text-neutral-400">{{ sizeKb(f.size) }}</td>
              <td class="px-4 py-2.5 text-neutral-600 dark:text-neutral-400">{{ f.notes ?? '—' }}</td>
              <td class="px-4 py-2.5 text-neutral-500">{{ relativeTime(f.created_at) }}</td>
              <td class="px-4 py-2.5 text-right">
                <button
                  type="button"
                  class="text-xs font-medium text-red-600 hover:text-red-700 dark:text-red-400"
                  @click="remove(f.id, f.version)"
                >Delete</button>
              </td>
            </tr>
            <tr v-if="!project.firmware.length">
              <td colspan="5" class="px-4 py-8 text-center text-sm text-neutral-500">
                No images yet. Upload one to update devices over the air.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div>
      <h2 class="mb-2 text-sm font-semibold">Devices</h2>
      <div class="overflow-hidden rounded-xl border border-neutral-200 dark:border-neutral-800">
        <table class="w-full text-sm">
          <thead class="bg-neutral-50 text-left text-xs uppercase tracking-wide text-neutral-500 dark:bg-neutral-900 dark:text-neutral-400">
            <tr>
              <th class="px-4 py-2.5 font-medium">Device</th>
              <th class="px-4 py-2.5 font-medium">Running</th>
              <th class="px-4 py-2.5 font-medium">Should run</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-neutral-200 dark:divide-neutral-800">
            <tr v-for="d in project.devices" :key="d.id">
              <td class="px-4 py-2.5 font-medium">{{ d.name }}</td>
              <td class="px-4 py-2.5 text-neutral-600 dark:text-neutral-400">{{ statusOf(d) }}</td>
              <td class="px-4 py-2.5">
                <select
                  :value="d.desired_firmware_id ?? ''"
                  class="w-full max-w-[14rem] rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950"
                  @change="assign(d.id, ($event.target as HTMLSelectElement).value)"
                >
                  <option value="">Nothing pending</option>
                  <option v-for="f in project.firmware" :key="f.id" :value="f.id">{{ f.version }}</option>
                </select>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="mt-2 text-xs text-neutral-500">
        Devices pull on their own schedule. A connected board is nudged to check immediately.
      </p>
    </div>
  </div>
</template>
