<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../../api';
import { useSerialPort } from '../../../composables/useSerialPort';
import { useEspFlasher, type FlashPart } from '../../../composables/useEspFlasher';
import { toast } from '../../../lib/toast';
import type { FirmwareCatalog } from '../../../types';

const { supported, port, request } = useSerialPort();
const { flash, phase, progress, chip, error } = useEspFlasher();

// A sketch built by Arduino starts here; a full factory image starts at 0.
const DEFAULT_OFFSET = 0x10000;

const source = ref<'example' | 'file'>('example');
const catalog = ref<FirmwareCatalog>({ tag: null, entries: [] });
const selected = ref('');
const file = ref<File | null>(null);
const offset = ref(DEFAULT_OFFSET);

onMounted(async () => {
  try {
    catalog.value = await api.get<FirmwareCatalog>('/v1/admin/firmware/catalog');
    selected.value = catalog.value.entries[0]?.file ?? '';
  } catch { /* no published examples is a normal state */ }
  if (!catalog.value.entries.length) source.value = 'file';
});

const ready = computed(() => (source.value === 'example' ? !!selected.value : !!file.value));

async function loadBytes(): Promise<Uint8Array> {
  if (source.value === 'file') return new Uint8Array(await file.value!.arrayBuffer());
  const res = await fetch(
    `/v1/admin/firmware/binary/${encodeURIComponent(catalog.value.tag ?? '')}/${encodeURIComponent(selected.value)}`,
    { credentials: 'include' }
  );
  if (!res.ok) throw new Error('Could not download that firmware');
  return new Uint8Array(await res.arrayBuffer());
}

const busy = computed(() => phase.value === 'connecting' || phase.value === 'writing');
const offsetHex = computed({
  get: () => `0x${offset.value.toString(16)}`,
  set: (v: string) => {
    const n = Number.parseInt(v.replace(/^0x/i, ''), 16);
    if (Number.isFinite(n) && n >= 0) offset.value = n;
  },
});

function pick(e: Event) {
  const input = e.target as HTMLInputElement;
  file.value = input.files?.[0] ?? null;
}

async function start() {
  if (!ready.value) return;
  if (!port.value && !(await request())) return;
  let parts: FlashPart[];
  try {
    parts = [{ data: await loadBytes(), address: offset.value }];
  } catch (e) {
    toast.error((e as Error).message);
    return;
  }
  const ok = await flash(parts);
  if (ok) toast.success('Flashed — the board is restarting');
  else toast.error(error.value ?? 'Flashing failed');
}
</script>

<template>
  <div v-if="!supported" class="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
    <h2 class="text-sm font-semibold">This browser can't flash boards</h2>
    <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
      Flashing needs the Web Serial API — Chrome, Edge or Opera on desktop, or Chrome on Android, over
      HTTPS. You can still flash from a terminal:
    </p>
    <pre class="mt-3 overflow-x-auto rounded-md bg-neutral-950 p-3 font-mono text-xs text-neutral-300"
>esptool.py --chip auto --port /dev/ttyUSB0 write_flash 0x10000 firmware.bin</pre>
  </div>

  <div v-else class="space-y-4">
    <div class="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div class="mb-3 flex gap-4 text-xs">
        <label class="flex items-center gap-1.5">
          <input v-model="source" type="radio" value="example" :disabled="!catalog.entries.length" />
          Published example
        </label>
        <label class="flex items-center gap-1.5">
          <input v-model="source" type="radio" value="file" />
          My own .bin
        </label>
      </div>

      <label v-if="source === 'example'" class="block">
        <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Example</span>
        <select
          v-model="selected"
          class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option v-for="e in catalog.entries" :key="e.file" :value="e.file">
            {{ e.example }} — {{ e.target }}
          </option>
        </select>
        <span class="mt-1 block text-[11px] text-neutral-500">
          Built from the SDK examples at {{ catalog.tag }}.
        </span>
      </label>

      <label v-else class="block">
        <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Firmware</span>
        <input
          type="file"
          accept=".bin"
          class="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-neutral-100 file:px-3 file:py-1.5 file:text-sm file:font-medium dark:file:bg-neutral-800 dark:file:text-neutral-200"
          @change="pick"
        />
      </label>

      <label class="mt-3 block max-w-[12rem]">
        <span class="block text-xs font-medium text-neutral-600 dark:text-neutral-300">Flash offset</span>
        <input
          v-model="offsetHex"
          class="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1 font-mono text-sm dark:border-neutral-700 dark:bg-neutral-950"
        />
        <span class="mt-1 block text-[11px] text-neutral-500">
          0x10000 for an Arduino sketch, 0x0 for a full image.
        </span>
      </label>

      <button
        type="button"
        :disabled="!ready || busy"
        class="mt-4 rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
        @click="start"
      >{{ busy ? 'Flashing…' : 'Flash' }}</button>

      <p class="mt-2 text-xs text-neutral-500">
        The console disconnects while flashing and reconnects when it finishes.
      </p>
    </div>

    <div v-if="phase !== 'idle'" class="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div class="flex items-center justify-between text-sm">
        <span class="font-medium">
          {{ phase === 'connecting' ? 'Connecting to the board…'
            : phase === 'writing' ? 'Writing'
            : phase === 'done' ? 'Done' : 'Failed' }}
        </span>
        <span v-if="chip" class="text-xs text-neutral-500">{{ chip }}</span>
      </div>
      <div v-if="phase === 'writing'" class="mt-2 h-1.5 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
        <div class="h-full bg-accent-600 transition-[width]" :style="{ width: `${Math.round(progress * 100)}%` }" />
      </div>
      <p v-if="error" class="mt-2 text-xs text-red-600 dark:text-red-400">{{ error }}</p>
    </div>
  </div>
</template>
