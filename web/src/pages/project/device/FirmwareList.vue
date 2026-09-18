<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectStore } from '../../../stores/project';
import { useSessionStore } from '../../../stores/session';
import { confirm } from '../../../lib/confirm';
import { toast } from '../../../lib/toast';
import { relativeTime, formatAbsolute } from '../../../lib/time';
import FirmwareUploadDialog from '../../../components/FirmwareUploadDialog.vue';
import type { Firmware } from '../../../types';

const project = useProjectStore();
const session = useSessionStore();

const showUpload = ref(false);

const isManager = computed(() => session.user?.role === 'owner' || session.user?.role === 'admin');

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} kB`;
}

// A board reports a version, not an id, so running matches on version.
function adoption(f: Firmware): string {
  const running = project.devices.filter((d) => d.firmware_version === f.version).length;
  const pending = project.devices.filter(
    (d) => d.desired_firmware_id === f.id && d.firmware_version !== f.version
  ).length;
  if (!running && !pending) return 'On no board yet';
  const parts: string[] = [];
  if (running) parts.push(`${running} running`);
  if (pending) parts.push(`${pending} pending`);
  return parts.join(' · ');
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
    <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <p class="max-w-xl text-sm text-neutral-600 dark:text-neutral-400">
        Compile with your own toolchain and upload the app image — <span class="font-mono text-xs">.ino.bin</span>,
        not the merged one. Assign it to a board on the Devices tab; it pulls the image on its next check.
      </p>
      <button
        v-if="isManager"
        type="button"
        class="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-accent-600 px-3.5 py-2 text-sm font-semibold text-white hover:bg-accent-700"
        @click="showUpload = true"
      >
        <svg class="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L8 8m4-4 4 4M4 20h16"/></svg>
        Upload firmware
      </button>
    </div>

    <ul class="mt-5 divide-y divide-neutral-200 overflow-hidden rounded-xl border border-neutral-200 dark:divide-neutral-800 dark:border-neutral-800">
      <li
        v-for="f in project.firmware"
        :key="f.id"
        class="flex items-start justify-between gap-4 px-4 py-3"
      >
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-medium">{{ f.version }}</span>
            <span
              v-if="f.target"
              class="rounded-full bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300"
            >{{ f.target }}</span>
            <span class="text-xs text-neutral-500 dark:text-neutral-400">{{ adoption(f) }}</span>
          </div>
          <p v-if="f.notes" class="mt-0.5 truncate text-sm text-neutral-600 dark:text-neutral-400">{{ f.notes }}</p>
          <div class="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {{ sizeLabel(f.size) }} · uploaded <span :title="formatAbsolute(f.created_at)">{{ relativeTime(f.created_at) }}</span>
            · <span class="font-mono" :title="f.sha256">{{ f.sha256.slice(0, 12) }}</span>
          </div>
        </div>
        <button
          v-if="isManager"
          type="button"
          class="shrink-0 rounded-md border border-red-300 px-3 py-1 text-xs text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
          @click="remove(f)"
        >Delete</button>
      </li>
      <li v-if="!project.firmware.length" class="px-4 py-10 text-center text-sm text-neutral-500 dark:text-neutral-400">
        No firmware yet. Upload an image to update boards without a cable.
      </li>
    </ul>

    <FirmwareUploadDialog v-if="showUpload" @close="showUpload = false" />
  </div>
</template>
