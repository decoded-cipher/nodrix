<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useProjectStore } from '../../../stores/project';
import { toast } from '../../../lib/toast';
import CodeEditor from '../../../components/CodeEditor.vue';
import { useEspFlasher } from '../../../composables/useEspFlasher';
import { useSerialPort } from '../../../composables/useSerialPort';
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

const FQBNS = [
  { value: 'esp32:esp32:esp32', label: 'ESP32' },
  { value: 'esp32:esp32:esp32s3', label: 'ESP32-S3' },
  { value: 'esp32:esp32:esp32c3', label: 'ESP32-C3' },
  { value: 'esp8266:esp8266:nodemcuv2', label: 'ESP8266 (NodeMCU)' },
];

const { flash } = useEspFlasher();
const { port, request } = useSerialPort();
const fqbn = ref(FQBNS[0]!.value);
const building = ref(false);
const buildLog = ref<string[]>([]);
const buildError = ref('');

type BuildResult = { ok: boolean; binary?: string; error?: string; log?: string[] };

async function compileAndFlash() {
  building.value = true;
  buildLog.value = [];
  buildError.value = '';
  try {
    const res = await api.post<BuildResult>(
      `/v1/admin/projects/${project.currentProjectId}/build`,
      { fqbn: fqbn.value, sketch: code.value }
    );
    buildLog.value = res.log ?? [];
    if (!res.ok || !res.binary) {
      buildError.value = res.error ?? 'Build failed';
      return;
    }
    if (!port.value && !(await request())) return;
    const bytes = Uint8Array.from(atob(res.binary), (ch) => ch.charCodeAt(0));
    const ok = await flash([{ data: bytes, address: 0x10000 }]);
    if (ok) toast.success('Flashed — the board is restarting');
  } catch (e) {
    buildError.value = (e as Error).message;
  } finally {
    building.value = false;
  }
}

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

    <div class="rounded-xl border border-neutral-200 p-4 dark:border-neutral-800">
      <div class="flex flex-wrap items-center gap-2">
        <select
          v-model="fqbn"
          class="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option v-for="b in FQBNS" :key="b.value" :value="b.value">{{ b.label }}</option>
        </select>
        <button
          type="button"
          :disabled="building"
          class="rounded-md bg-accent-600 px-4 py-2 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
          @click="compileAndFlash"
        >{{ building ? 'Building…' : 'Compile and flash' }}</button>
        <p class="text-xs text-neutral-500">
          Builds on your machine via the nodrix agent. A first build installs the toolchain and takes minutes.
        </p>
      </div>

      <p v-if="buildError" class="mt-2 text-xs text-red-600 dark:text-red-400">{{ buildError }}</p>
      <pre
        v-if="buildLog.length"
        class="mt-3 max-h-56 overflow-auto rounded-md bg-neutral-950 p-3 font-mono text-xs text-neutral-300"
      >{{ buildLog.join('\n') }}</pre>
    </div>
  </div>
</template>
