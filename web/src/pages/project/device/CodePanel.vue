<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';
import { api } from '../../../api';
import { useProjectStore } from '../../../stores/project';
import { toast } from '../../../lib/toast';
import CodeEditor from '../../../components/CodeEditor.vue';
import SerialMonitor from '../../../components/SerialMonitor.vue';
import { useEspFlasher } from '../../../composables/useEspFlasher';
import { useSerialPort } from '../../../composables/useSerialPort';
import { runBuild } from '../../../composables/useAgentBuild';
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

// ESP32 keeps a bootloader and partition table below the app; an ESP8266 sketch
// is the whole image and starts at zero.
const FQBNS = [
  { value: 'esp32:esp32:esp32', label: 'ESP32', offset: 0x10000 },
  { value: 'esp32:esp32:esp32s3', label: 'ESP32-S3', offset: 0x10000 },
  { value: 'esp32:esp32:esp32c3', label: 'ESP32-C3', offset: 0x10000 },
  { value: 'esp8266:esp8266:nodemcuv2', label: 'ESP8266 (NodeMCU)', offset: 0x0 },
];

const { flash, phase, progress } = useEspFlasher();
const { supported, port, request } = useSerialPort();

const catalog = ref<FirmwareCatalog>({ tag: null, entries: [] });
const example = ref('');
const code = ref('');
const loading = ref(false);

const fqbn = ref(FQBNS[0]!.value);
const flashOffset = computed(() => FQBNS.find((b) => b.value === fqbn.value)?.offset ?? 0x10000);
const building = ref(false);
const saving = ref(false);
const buildLog = ref<string[]>([]);
const buildError = ref('');
// The artifact outlives the flash, so the same build can also be kept for OTA.
const lastBuild = ref('');

const tab = ref<'console' | 'serial'>('console');
const consoleEl = ref<HTMLElement | null>(null);

const busy = computed(() => building.value || phase.value === 'connecting' || phase.value === 'writing');

watch(buildLog, async () => {
  if (tab.value !== 'console') return;
  await nextTick();
  const el = consoleEl.value;
  if (el) el.scrollTop = el.scrollHeight;
}, { deep: true });

async function build(): Promise<string | null> {
  tab.value = 'console';
  building.value = true;
  buildLog.value = [];
  buildError.value = '';
  lastBuild.value = '';
  try {
    const res = await runBuild(
      project.currentProjectId ?? '',
      { fqbn: fqbn.value, sketch: code.value },
      (line) => buildLog.value.push(line)
    );
    if (!res.ok) {
      buildError.value = res.error;
      return null;
    }
    lastBuild.value = res.build;
    return res.build;
  } catch (e) {
    buildError.value = (e as Error).message;
    return null;
  } finally {
    building.value = false;
  }
}

async function compileAndFlash() {
  const id = await build();
  if (!id) return;
  try {
    if (!port.value && !(await request())) return;
    const pid = project.currentProjectId ?? '';
    const bytes = new Uint8Array(await api.bytes(`/v1/admin/projects/${pid}/build/${id}/artifact`));
    if (await flash([{ data: bytes, address: flashOffset.value }])) {
      toast.success('Flashed — the board is restarting');
      tab.value = 'serial';
    }
  } catch (e) {
    buildError.value = (e as Error).message;
  }
}

async function saveForOta() {
  const id = lastBuild.value || (await build());
  if (!id) return;
  saving.value = true;
  try {
    await project.publishBuild(id);
    toast.success('Saved — pick it on any device to send it over the air');
  } catch (e) {
    toast.error((e as Error).message);
  } finally {
    saving.value = false;
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
</script>

<template>
  <div class="flex h-[calc(100vh-15rem)] min-h-[34rem] flex-col gap-2">
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        :disabled="busy || !supported"
        class="rounded-md bg-accent-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-accent-700 disabled:opacity-50"
        @click="compileAndFlash"
      >{{ building ? 'Building…' : phase === 'writing' ? 'Writing…' : 'Flash' }}</button>
      <button
        type="button"
        :disabled="busy || saving"
        class="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
        @click="saveForOta"
      >{{ saving ? 'Saving…' : 'Save for OTA' }}</button>

      <select
        v-model="fqbn"
        class="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-950"
      >
        <option v-for="b in FQBNS" :key="b.value" :value="b.value">{{ b.label }}</option>
      </select>

      <div class="ml-auto flex flex-wrap items-center gap-2">
        <select
          v-model="example"
          class="rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-xs dark:border-neutral-700 dark:bg-neutral-950"
        >
          <option value="">Example…</option>
          <option v-for="e in examples" :key="e" :value="e">{{ e }}</option>
        </select>
        <button
          type="button"
          :disabled="!example || loading"
          class="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="loadExample"
        >{{ loading ? 'Loading…' : 'Load' }}</button>
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="copy"
        >Copy</button>
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="download"
        >Download</button>
      </div>
    </div>

    <p v-if="!supported" class="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      Flashing and the serial monitor need Web Serial — Chrome, Edge or Opera on desktop, or Chrome on
      Android. Everything else in nodrix works here.
    </p>

    <div class="min-h-0 flex-1">
      <CodeEditor v-model="code" />
    </div>

    <div class="flex h-[16rem] shrink-0 flex-col rounded-xl border border-neutral-200 dark:border-neutral-800">
      <div class="flex shrink-0 items-center gap-4 border-b border-neutral-200 px-3 dark:border-neutral-800">
        <button
          v-for="t in (['console', 'serial'] as const)"
          :key="t"
          type="button"
          class="border-b-2 py-2 text-xs font-medium transition"
          :class="tab === t
            ? 'border-accent-600 text-accent-700 dark:text-accent-400'
            : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-100'"
          @click="tab = t"
        >{{ t === 'console' ? 'Console' : 'Serial monitor' }}</button>

        <div v-if="phase === 'writing'" class="ml-auto flex items-center gap-2 text-[11px] text-neutral-500">
          Writing
          <div class="h-1 w-24 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-800">
            <div class="h-full bg-accent-600 transition-[width]" :style="{ width: `${Math.round(progress * 100)}%` }" />
          </div>
        </div>
      </div>

      <div v-show="tab === 'console'" ref="consoleEl" class="min-h-0 flex-1 overflow-y-auto p-3">
        <p v-if="!buildLog.length && !buildError" class="font-mono text-xs text-neutral-500">
          Press Flash to build this sketch on your machine. A first build installs the toolchain and takes minutes.
        </p>
        <pre v-if="buildLog.length" class="whitespace-pre-wrap break-all font-mono text-xs text-neutral-600 dark:text-neutral-300">{{ buildLog.join('\n') }}</pre>
        <p v-if="buildError" class="mt-2 font-mono text-xs text-red-600 dark:text-red-400">{{ buildError }}</p>
      </div>

      <div v-show="tab === 'serial'" class="min-h-0 flex-1 p-3">
        <SerialMonitor />
      </div>
    </div>
  </div>
</template>
