<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectStore } from '../../../stores/project';
import { useSessionStore } from '../../../stores/session';
import { confirm } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import { relativeTime, formatAbsolute } from '../../../lib/time';
import FirmwareUploadDialog from '../../../components/FirmwareUploadDialog.vue';
import Icon from '../../../components/Icon.vue';
import type { Firmware } from '../../../types';

const project = useProjectStore();
const session = useSessionStore();

const UPLOAD_ICON = 'M12 16V4m0 0L8 8m4-4 4 4M4 20h16';

const showUpload = ref(false);

const isManager = computed(() => session.user?.role === 'owner' || session.user?.role === 'admin');

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(2)} MB`
    : `${Math.round(bytes / 1024)} kB`;
}

const boards = computed(() =>
  Object.fromEntries(
    project.firmware.map((f) => [
      f.id,
      {
        running: project.listedDevices.filter((d) => d.firmware_version === f.version),
        updating: project.listedDevices.filter(
          (d) => d.desired_firmware_id === f.id && d.firmware_version !== f.version && d.ota_status !== 'failed'
        ),
      },
    ])
  )
);

function names(list: { name: string }[]): string {
  return list.length === 1 ? list[0]!.name : `${list.length} boards`;
}

async function copySha(f: Firmware) {
  try {
    await navigator.clipboard.writeText(f.sha256);
    toast.success('SHA-256 copied.');
  } catch { /* clipboard blocked */ }
}

async function remove(f: Firmware) {
  const ok = await confirm({
    title: `Delete ${f.version}?`,
    message: 'The image is removed from storage.',
    details: [
      'Any board waiting for it stops being offered the update.',
      'Boards already running it are unaffected.',
    ],
    confirmLabel: 'Delete',
  });
  if (!ok) return;
  try {
    await project.deleteFirmware(f.id);
  } catch (e) {
    toast.error((e as Error).message);
  }
}
</script>

<template>
  <div>
    <template v-if="project.firmware.length">
      <div class="mb-4 flex items-center justify-between gap-3">
        <p class="text-sm text-neutral-600 dark:text-neutral-400">
          Roll a version out from <span class="font-medium text-neutral-800 dark:text-neutral-200">Update to</span> on a device.
        </p>
        <button
          v-if="isManager"
          type="button"
          class="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700"
          @click="showUpload = true"
        >
          <Icon :path="UPLOAD_ICON" class="h-4 w-4" />
          Upload firmware
        </button>
      </div>

      <div class="overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-900">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-neutral-100 bg-neutral-50 text-xs uppercase tracking-wide text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400">
            <tr>
              <th class="px-4 py-2.5 font-medium">Version</th>
              <th class="px-4 py-2.5 font-medium">Boards</th>
              <th class="hidden px-4 py-2.5 font-medium sm:table-cell">Size</th>
              <th class="hidden px-4 py-2.5 font-medium md:table-cell">Uploaded</th>
              <th class="hidden px-4 py-2.5 font-medium lg:table-cell">SHA-256</th>
              <th class="px-4 py-2.5"><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody class="divide-y divide-neutral-100 dark:divide-neutral-800">
            <tr v-for="(f, i) in project.firmware" :key="f.id" class="group align-top hover:bg-neutral-50 dark:hover:bg-neutral-800/50">
              <td class="px-4 py-2.5">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="font-mono text-sm font-medium">{{ f.version }}</span>
                  <span
                    v-if="i === 0"
                    class="rounded-full bg-accent-50 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent-700 dark:bg-accent-900/30 dark:text-accent-300"
                  >Latest</span>
                  <span
                    v-if="f.target"
                    class="rounded-full bg-neutral-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:bg-neutral-800 dark:text-neutral-400"
                  >{{ f.target }}</span>
                </div>
                <p v-if="f.notes" class="mt-0.5 text-xs text-neutral-600 dark:text-neutral-300">{{ f.notes }}</p>
                <p class="mt-0.5 text-xs text-neutral-500 sm:hidden dark:text-neutral-400">
                  {{ sizeLabel(f.size) }} · {{ relativeTime(f.created_at) }}
                </p>
              </td>
              <td class="px-4 py-2.5 text-xs">
                <p
                  v-if="boards[f.id]!.running.length"
                  class="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400"
                  :title="boards[f.id]!.running.map((d) => d.name).join(', ')"
                >
                  <span class="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                  <span class="truncate">Running on {{ names(boards[f.id]!.running) }}</span>
                </p>
                <p
                  v-if="boards[f.id]!.updating.length"
                  class="flex items-center gap-1.5 text-accent-700 dark:text-accent-400"
                  :title="boards[f.id]!.updating.map((d) => d.name).join(', ')"
                >
                  <span class="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-accent-500" />
                  <span class="truncate">Updating {{ names(boards[f.id]!.updating) }}</span>
                </p>
                <span
                  v-if="!boards[f.id]!.running.length && !boards[f.id]!.updating.length"
                  class="italic text-neutral-400 dark:text-neutral-600"
                >None</span>
              </td>
              <td class="hidden px-4 py-2.5 text-xs text-neutral-600 sm:table-cell dark:text-neutral-300">{{ sizeLabel(f.size) }}</td>
              <td class="hidden px-4 py-2.5 text-xs text-neutral-500 md:table-cell dark:text-neutral-400">
                <span :title="formatAbsolute(f.created_at)">{{ relativeTime(f.created_at) }}</span>
              </td>
              <td class="hidden px-4 py-2.5 lg:table-cell">
                <button
                  type="button"
                  class="font-mono text-xs text-neutral-500 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100"
                  :title="`${f.sha256} · click to copy`"
                  @click="copySha(f)"
                >{{ f.sha256.slice(0, 12) }}</button>
              </td>
              <td class="px-4 py-2.5">
                <div class="flex items-center justify-end">
                  <button
                    v-if="isManager"
                    type="button"
                    aria-label="Delete firmware"
                    title="Delete firmware"
                    class="rounded-md p-1.5 text-neutral-400 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/40 dark:hover:text-red-400"
                    @click="remove(f)"
                  >
                    <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <div v-else class="overflow-hidden rounded-lg border border-neutral-200 bg-white px-4 py-12 text-center dark:border-neutral-800 dark:bg-neutral-900">
      <p class="text-sm font-medium text-neutral-700 dark:text-neutral-300">No firmware yet</p>
      <p class="mx-auto mt-1 max-w-md text-xs text-neutral-500 dark:text-neutral-400">
        Name the version with <span class="font-mono">Nodrix.setFirmwareVersion("1.0.1")</span>, export the
        <span class="font-mono">.ino.bin</span> (Sketch → Export Compiled Binary), and upload it under the same version.
      </p>
      <button
        v-if="isManager"
        type="button"
        class="mt-4 rounded-md bg-accent-600 px-4 py-2 text-xs font-semibold text-white hover:bg-accent-700"
        @click="showUpload = true"
      >Upload firmware</button>
    </div>

    <FirmwareUploadDialog v-if="showUpload" @close="showUpload = false" />
  </div>
</template>
