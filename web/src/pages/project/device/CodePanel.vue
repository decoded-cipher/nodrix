<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useProjectStore } from '../../../stores/project';
import { toast } from '../../../lib/toast';
import CodeEditor from '../../../components/CodeEditor.vue';
import type { FirmwareCatalog } from '../../../types';

const project = useProjectStore();

const SDK_REPO = 'decoded-cipher/nodrix-sdk';
const STARTER = `#include <Nodrix.h>

void setup() {
  Serial.begin(115200);
  Nodrix.setDebug(true);
  Nodrix.addAP("your-wifi", "your-password");
  Nodrix.begin("your-instance.workers.dev", "your-connection-token");
}

void loop() {
  Nodrix.run();
}
`;

const catalog = ref<FirmwareCatalog>({ tag: null, entries: [] });
const example = ref('');
const code = ref('');
const loading = ref(false);

// The catalogue lists one binary per chip, so names repeat.
const examples = computed(() => [...new Set(catalog.value.entries.map((e) => e.example))]);

const storageKey = computed(() => `nodrix:sketch:${project.currentProjectId ?? 'none'}`);

onMounted(async () => {
  code.value = localStorage.getItem(storageKey.value) ?? STARTER;
  try {
    catalog.value = await api.get<FirmwareCatalog>('/v1/admin/firmware/catalog');
  } catch { /* no published release yet */ }
});

watch(code, (v) => localStorage.setItem(storageKey.value, v));

// Same tag the binaries were built at, so this is what a published image is.
async function loadExample() {
  if (!example.value || !catalog.value.tag) return;
  loading.value = true;
  try {
    const url = `https://raw.githubusercontent.com/${SDK_REPO}/${catalog.value.tag}/examples/${example.value}/${example.value}.ino`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Could not load that example');
    code.value = await res.text();
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    loading.value = false;
  }
}

async function copy() {
  await navigator.clipboard.writeText(code.value);
  toast.success('Sketch copied');
}

function download() {
  const blob = new Blob([code.value], { type: 'text/plain' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sketch.ino';
  a.click();
  URL.revokeObjectURL(a.href);
}

function reset() {
  code.value = STARTER;
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <select
        v-model="example"
        class="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      >
        <option value="">Load an example…</option>
        <option v-for="e in examples" :key="e" :value="e">{{ e }}</option>
      </select>
      <button
        type="button"
        :disabled="!example || loading"
        class="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        @click="loadExample"
      >{{ loading ? 'Loading…' : 'Load' }}</button>

      <div class="ml-auto flex gap-2">
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="copy"
        >Copy</button>
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="download"
        >Download .ino</button>
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="reset"
        >Reset</button>
      </div>
    </div>

    <CodeEditor v-model="code" />

    <div class="rounded-xl border border-dashed border-neutral-300 p-4 text-sm dark:border-neutral-700">
      <p class="font-medium">Compiling needs the nodrix agent</p>
      <p class="mt-1 text-neutral-600 dark:text-neutral-400">
        A browser can't run a C++ toolchain — the ESP32 sysroot alone is over 150 MB. The agent runs on
        your machine, builds with your own Arduino toolchain, and sends the binary back here to flash.
        Until it's installed, download the sketch and build it in the Arduino IDE.
      </p>
    </div>
  </div>
</template>
