<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { useSerialPort, BAUD_RATES } from '../../../composables/useSerialPort';
import { useSerialLog, type LogEntry } from '../../../composables/useSerialLog';
import { useSerialDiagnosis } from '../../../composables/useSerialDiagnosis';
import { toast } from '../../../lib/toast';

const { supported, port, state, lastError, request, startMonitor, stopMonitor, setBaud } = useSerialPort();
const { entries, paused, garbled, setPaused, clear, toText } = useSerialLog();
const diagnosis = useSerialDiagnosis();

const viewport = ref<HTMLElement | null>(null);
const stuckToBottom = ref(true);
const baud = ref(115200);

const connected = computed(() => state.value === 'open');
const busy = computed(() => state.value === 'opening' || state.value === 'busy');

function onScroll() {
  const el = viewport.value;
  if (!el) return;
  stuckToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
}

watch(entries, async () => {
  if (!stuckToBottom.value) return;
  await nextTick();
  const el = viewport.value;
  if (el) el.scrollTop = el.scrollHeight;
});

async function connect() {
  if (!port.value && !(await request())) return;
  try {
    await startMonitor(baud.value);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function disconnect() {
  await stopMonitor();
}

async function changeBaud() {
  try {
    await setBaud(baud.value);
  } catch (e) {
    toast.error((e as Error).message);
  }
}

async function copyAll() {
  await navigator.clipboard.writeText(toText());
  toast.success('Console copied');
}

// The viewport is dark in both themes, so these take no light variant.
const DIAGNOSIS_TONE = {
  ok: 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200',
  warn: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200',
  error: 'border-red-300 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200',
};

const TONE: Record<LogEntry['level'], string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  error: 'text-red-400',
  system: 'text-neutral-500 italic',
  info: 'text-neutral-300',
};

function stamp(at: number) {
  return new Date(at).toTimeString().slice(0, 8);
}
</script>

<template>
  <div v-if="!supported" class="rounded-xl border border-neutral-200 bg-white p-6 dark:border-neutral-800 dark:bg-neutral-900">
    <h2 class="text-sm font-semibold">This browser can't talk to serial devices</h2>
    <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
      The console uses the Web Serial API, which needs Chrome, Edge or Opera on desktop, or Chrome on
      Android. Safari and Firefox don't support it. It also needs a secure (HTTPS) connection.
    </p>
    <p class="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
      Everything else in nodrix works here — this page is the only part that needs direct USB access.
    </p>
  </div>

  <div v-else class="space-y-3">
    <div class="flex flex-wrap items-center gap-2">
      <button
        type="button"
        :disabled="busy"
        class="rounded-md px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
        :class="connected ? 'bg-neutral-700 hover:bg-neutral-800' : 'bg-accent-600 hover:bg-accent-700'"
        @click="connected ? disconnect() : connect()"
      >{{ connected ? 'Disconnect' : busy ? 'Connecting…' : 'Connect' }}</button>

      <label class="flex items-center gap-1.5 text-xs text-neutral-600 dark:text-neutral-400">
        Baud
        <select
          v-model.number="baud"
          class="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm dark:border-neutral-700 dark:bg-neutral-950 dark:text-neutral-100"
          @change="changeBaud"
        >
          <option v-for="b in BAUD_RATES" :key="b" :value="b">{{ b }}</option>
        </select>
      </label>

      <div class="ml-auto flex items-center gap-2">
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="setPaused(!paused)"
        >{{ paused ? 'Resume' : 'Pause' }}</button>
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="copyAll"
        >Copy</button>
        <button
          type="button"
          class="rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs font-medium hover:bg-neutral-50 dark:border-neutral-700 dark:hover:bg-neutral-800"
          @click="clear()"
        >Clear</button>
      </div>
    </div>

    <div v-if="diagnosis" class="rounded-lg border px-3 py-2" :class="DIAGNOSIS_TONE[diagnosis.tone]">
      <p class="text-sm font-semibold">{{ diagnosis.headline }}</p>
      <p v-if="diagnosis.detail" class="mt-0.5 text-xs opacity-90">{{ diagnosis.detail }}</p>
    </div>

    <p v-if="garbled" class="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
      This looks like the wrong baud rate. Most nodrix sketches use 115200.
    </p>

    <p v-if="lastError" class="text-xs text-red-600 dark:text-red-400">{{ lastError }}</p>

    <div
      ref="viewport"
      class="h-[26rem] overflow-y-auto rounded-xl border border-neutral-200 bg-neutral-950 p-3 font-mono text-xs leading-relaxed dark:border-neutral-800"
      @scroll="onScroll"
    >
      <p v-if="!entries.length" class="text-neutral-500">
        Connect a board to see what it's printing. Call <code>Nodrix.setDebug(true)</code> in your sketch
        for connection details.
      </p>
      <div v-for="e in entries" :key="e.id" class="flex gap-2 whitespace-pre-wrap break-all">
        <span class="shrink-0 text-neutral-500 tabular-nums">{{ stamp(e.at) }}</span>
        <span v-if="e.tag" class="shrink-0 text-neutral-500">{{ e.tag }}</span>
        <span :class="TONE[e.level]">{{ e.text }}</span>
      </div>
    </div>

    <p v-if="!stuckToBottom" class="text-xs text-neutral-500">Scrolled up — new lines aren't following.</p>
  </div>
</template>
