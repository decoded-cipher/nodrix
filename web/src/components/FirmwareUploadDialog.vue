<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectStore } from '../stores/project';
import { toast } from '../lib/toast';

const emit = defineEmits<{ close: [] }>();

const project = useProjectStore();

const fileEl = ref<HTMLInputElement | null>(null);
const file = ref<File | null>(null);
const version = ref('');
const notes = ref('');
const submitting = ref(false);

const sizeLabel = computed(() => (file.value ? `${(file.value.size / 1024).toFixed(0)} kB` : ''));
const canSubmit = computed(() => !!file.value && !!version.value.trim() && !submitting.value);

function pick(e: Event) {
  const input = e.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close');
}

async function submit() {
  if (!file.value || !version.value.trim()) return;
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
            Compile with your own toolchain, then upload the image.
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
          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-neutral-700 dark:text-neutral-300">Image</label>
            <input ref="fileEl" type="file" accept=".bin" class="sr-only" @change="pick" />
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="shrink-0 rounded-md border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:bg-neutral-800"
                @click="fileEl?.click()"
              >{{ file ? 'Change file' : 'Choose file' }}</button>
              <span
                class="min-w-0 truncate text-xs"
                :class="file ? 'text-neutral-700 dark:text-neutral-300' : 'text-neutral-400 dark:text-neutral-500'"
              >{{ file ? `${file.name} · ${sizeLabel}` : 'No file chosen' }}</span>
            </div>
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              The app image — <span class="font-mono">.ino.bin</span>, not the merged one. Up to 8 MB.
            </p>
          </div>

          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-neutral-700 dark:text-neutral-300">Version</label>
            <input
              v-model="version"
              placeholder="1.2.0"
              class="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm focus:border-accent-500 focus:outline-none focus:ring-2 focus:ring-accent-500/30 dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
            />
            <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
              Must match what the sketch passes to <span class="font-mono">setFirmwareVersion()</span>, or the board
              keeps reinstalling it.
            </p>
          </div>

          <div class="space-y-1.5">
            <label class="block text-xs font-medium text-neutral-700 dark:text-neutral-300">Notes (optional)</label>
            <input
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
