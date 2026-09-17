<script setup lang="ts">
import { computed, ref } from 'vue';
import { useProjectStore } from '../stores/project';
import { toast } from '../lib/toast';

const emit = defineEmits<{ close: [] }>();

const project = useProjectStore();

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
  <div class="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" @click.self="emit('close')">
    <div class="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-xl border border-neutral-200 bg-white p-5 shadow-xl dark:border-neutral-800 dark:bg-neutral-900">
      <h2 class="text-lg font-semibold">Upload firmware</h2>
      <p class="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
        Compile your sketch, then upload the app image — <span class="font-mono text-xs">.ino.bin</span>, not the
        merged one.
      </p>

      <form class="mt-4 space-y-4" @submit.prevent="submit">
        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-neutral-700 dark:text-neutral-300">Image</label>
          <input
            type="file"
            accept=".bin"
            class="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-100 file:px-2 file:py-1 file:text-xs dark:border-neutral-700 dark:file:bg-neutral-800"
            @change="pick"
          />
          <p v-if="file" class="text-[11px] text-neutral-500">{{ file.name }} · {{ sizeLabel }}</p>
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-neutral-700 dark:text-neutral-300">Version</label>
          <input
            v-model="version"
            placeholder="1.2.0"
            class="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
          <p class="text-[11px] text-neutral-500 dark:text-neutral-400">
            Must match what the sketch passes to
            <span class="font-mono">setFirmwareVersion()</span>, or the board keeps reinstalling it.
          </p>
        </div>

        <div class="space-y-1.5">
          <label class="block text-xs font-medium text-neutral-700 dark:text-neutral-300">Notes (optional)</label>
          <input
            v-model="notes"
            placeholder="What changed"
            class="w-full rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-950"
          />
        </div>

        <div class="flex justify-end gap-2 pt-1">
          <button
            type="button"
            class="rounded-md border border-neutral-300 px-3 py-1.5 text-xs hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
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
