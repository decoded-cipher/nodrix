<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectStore } from '../stores/project';
import { toast } from '../lib/toast';

const emit = defineEmits<{ close: [] }>();

const project = useProjectStore();

const MAX_BYTES = 8 * 1024 * 1024;
const SAFE_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const CHIP_IDS: Record<number, string> = {
  0x0000: 'ESP32', 0x0002: 'ESP32-S2', 0x0005: 'ESP32-C3', 0x0009: 'ESP32-S3',
  0x000c: 'ESP32-C2', 0x000d: 'ESP32-C6', 0x0010: 'ESP32-H2',
};

const fileEl = ref<HTMLInputElement | null>(null);
const file = ref<File | null>(null);
const fileKind = ref('');
const fileError = ref('');
const dragging = ref(false);
const version = ref('');
const notes = ref('');
const submitting = ref(false);

const sizeLabel = computed(() => {
  if (!file.value) return '';
  const b = file.value.size;
  return b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(2)} MB` : `${Math.round(b / 1024)} kB`;
});

const versionError = computed(() => {
  const v = version.value.trim();
  if (!v) return '';
  if (!SAFE_VERSION.test(v)) return 'Letters, digits, dot, underscore, plus or dash.';
  if (project.firmware.some((f) => f.version === v)) return `${v} is already uploaded.`;
  return '';
});

const canSubmit = computed(
  () => !!file.value && !fileError.value && !!version.value.trim() && !versionError.value && !submitting.value
);

async function inspect(f: File) {
  fileKind.value = '';
  fileError.value = '';
  if (f.size > MAX_BYTES) {
    fileError.value = 'Larger than 8 MB.';
    return;
  }
  const head = new Uint8Array(await f.slice(0, 0x8002).arrayBuffer());
  if (head.length < 24 || head[0] !== 0xe9) {
    fileError.value = "Not an ESP firmware image.";
  } else if (head.length > 0x8001 && head[0x8000] === 0xaa && head[0x8001] === 0x50) {
    fileError.value = 'A merged flash image. Upload the .ino.bin app image instead.';
  } else {
    const chip = CHIP_IDS[head[12]! | (head[13]! << 8)];
    fileKind.value = chip ? `${chip} app image` : 'ESP app image';
  }
}

function take(f: File | null | undefined) {
  file.value = f ?? null;
  if (f) void inspect(f);
}

function pick(e: Event) {
  take((e.target as HTMLInputElement).files?.[0]);
}

function drop(e: DragEvent) {
  dragging.value = false;
  take(e.dataTransfer?.files?.[0]);
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

async function submit() {
  if (!canSubmit.value || !file.value) return;
  submitting.value = true;
  try {
    const form = new FormData();
    form.set('file', file.value);
    form.set('version', version.value.trim());
    if (notes.value.trim()) form.set('notes', notes.value.trim());
    await project.uploadFirmware(form);
    toast.success(`Firmware ${version.value.trim()} uploaded.`);
    emit('close');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-neutral-900/40 px-4 dark:bg-black/70"
    role="dialog"
    aria-modal="true"
    @click.self="emit('close')"
    @keydown="onKey"
  >
    <div class="flex max-h-[90dvh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-xl dark:bg-neutral-900 dark:ring-1 dark:ring-neutral-800">
      <header class="flex items-start justify-between gap-3 border-b border-neutral-100 px-5 py-3 dark:border-neutral-800">
        <div class="min-w-0">
          <h2 class="text-sm font-semibold leading-tight text-neutral-900 dark:text-neutral-100">Upload firmware</h2>
          <p class="mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400">
            The app image your toolchain built, under the version the sketch reports.
          </p>
        </div>
        <button
          type="button"
          class="-mr-1 -mt-0.5 shrink-0 rounded-md p-1 text-neutral-400 transition hover:bg-neutral-100 hover:text-neutral-700 dark:hover:bg-neutral-800 dark:hover:text-neutral-200"
          aria-label="Close"
          @click="emit('close')"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" class="h-4 w-4">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </header>

      <form class="flex min-h-0 flex-col" @submit.prevent="submit">
        <div class="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <input ref="fileEl" type="file" accept=".bin" class="sr-only" @change="pick" />
            <button
              type="button"
              class="flex w-full flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-5 text-center transition focus:outline-none focus:ring-2 focus:ring-accent-500/30"
              :class="dragging
                ? 'border-accent-500 bg-accent-50 dark:bg-accent-950/30'
                : fileError
                  ? 'border-red-300 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20'
                  : 'border-neutral-300 hover:border-neutral-400 hover:bg-neutral-50 dark:border-neutral-700 dark:hover:border-neutral-600 dark:hover:bg-neutral-800/50'"
              @click="fileEl?.click()"
              @dragover.prevent="dragging = true"
              @dragleave.prevent="dragging = false"
              @drop.prevent="drop"
            >
              <template v-if="file">
                <span class="max-w-full truncate text-sm font-medium text-neutral-900 dark:text-neutral-100">{{ file.name }}</span>
                <span class="text-xs" :class="fileError ? 'text-red-600 dark:text-red-400' : 'text-neutral-500 dark:text-neutral-400'">
                  {{ fileError || `${fileKind || 'Checking…'} · ${sizeLabel}` }}
                </span>
                <span class="mt-1 text-[11px] text-accent-700 dark:text-accent-400">Choose another</span>
              </template>
              <template v-else>
                <svg class="h-5 w-5 text-neutral-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4m0 0L8 8m4-4 4 4M4 20h16"/></svg>
                <span class="text-sm text-neutral-700 dark:text-neutral-300">Drop the <span class="font-mono text-xs">.ino.bin</span> here, or click to choose</span>
                <span class="text-[11px] text-neutral-500 dark:text-neutral-400">The app image, not the merged one. Up to 8 MB.</span>
              </template>
            </button>
          </div>

          <div class="space-y-1.5">
            <label for="fw-version" class="block text-xs font-medium text-neutral-700 dark:text-neutral-300">Version</label>
            <input
              id="fw-version"
              v-model="version"
              placeholder="1.2.0"
              autocomplete="off"
              class="w-full rounded-md border bg-white px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 dark:bg-neutral-950 dark:text-neutral-100"
              :class="versionError
                ? 'border-red-300 focus:border-red-500 focus:ring-red-500/30 dark:border-red-900'
                : 'border-neutral-300 focus:border-accent-500 focus:ring-accent-500/30 dark:border-neutral-700'"
            />
            <p v-if="versionError" class="text-[11px] text-red-600 dark:text-red-400">{{ versionError }}</p>
            <p v-else class="text-[11px] text-neutral-500 dark:text-neutral-400">
              Exactly what the sketch passes to <span class="font-mono">setFirmwareVersion()</span>.
            </p>
          </div>

          <div class="space-y-1.5">
            <label for="fw-notes" class="block text-xs font-medium text-neutral-700 dark:text-neutral-300">Notes <span class="font-normal text-neutral-400">(optional)</span></label>
            <input
              id="fw-notes"
              v-model="notes"
              placeholder="What changed"
              class="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
          </div>
        </div>

        <div class="flex items-center justify-end gap-2 border-t border-neutral-100 bg-neutral-50 px-5 py-3 dark:border-neutral-800 dark:bg-neutral-950">
          <button
            type="button"
            class="rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
            @click="emit('close')"
          >Cancel</button>
          <button
            type="submit"
            :disabled="!canSubmit"
            class="rounded-md bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
          >{{ submitting ? 'Uploading…' : 'Upload' }}</button>
        </div>
      </form>
    </div>
  </div>
</template>
