// Single owner of the page's one SerialPort. The monitor holds an exclusive
// reader and the flasher needs it closed, so both go through claim().

import { ref, shallowRef } from 'vue';

export type PortMode = 'monitor' | 'flash' | 'provision';
export type PortState = 'unsupported' | 'closed' | 'opening' | 'open' | 'busy';

// Flash progress comes from esptool-js, not over the port.
export type LogSource = 'device' | 'flash' | 'system';
export type LogLine = { source: LogSource; text: string; at: number };

export const serialSupported =
  typeof navigator !== 'undefined' && 'serial' in navigator && window.isSecureContext;

// 74880 is the ESP8266 boot ROM's rate; its reset banner is mojibake elsewhere.
export const BAUD_RATES = [9600, 19200, 38400, 57600, 74880, 115200, 230400, 460800, 921600];

// The SDK dots through a Wi-Fi connect without newlines.
const PARTIAL_LINE_FLUSH_MS = 250;

const port = shallowRef<SerialPort | null>(null);
const state = ref<PortState>(serialSupported ? 'closed' : 'unsupported');
const mode = ref<PortMode | null>(null);
const baudRate = ref(115200);
const lastError = ref<string | null>(null);

const listeners = new Set<(line: LogLine) => void>();
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let readLoop: Promise<void> | null = null;
let carry = '';
let flushTimer: ReturnType<typeof setTimeout> | null = null;

let chain: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

function deliver(source: LogSource, text: string) {
  const line = { source, text, at: Date.now() };
  for (const fn of listeners) fn(line);
}

export function emit(source: LogSource, text: string) {
  deliver(source, text);
}

function flushCarry() {
  if (!carry) return;
  deliver('device', carry);
  carry = '';
}

function absorb(chunk: string) {
  carry += chunk.replace(/\r/g, '');
  const parts = carry.split('\n');
  carry = parts.pop() ?? '';
  for (const line of parts) deliver('device', line);
  if (flushTimer) clearTimeout(flushTimer);
  if (carry) flushTimer = setTimeout(flushCarry, PARTIAL_LINE_FLUSH_MS);
}

async function pump(p: SerialPort) {
  const decoder = new TextDecoder();
  while (p.readable && mode.value === 'monitor') {
    reader = p.readable.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        if (value) absorb(decoder.decode(value, { stream: true }));
      }
    } catch (e) {
      lastError.value = (e as Error).message;
      return;
    } finally {
      try { reader.releaseLock(); } catch { /* already released */ }
      reader = null;
    }
  }
}

async function teardown() {
  mode.value = null;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  flushCarry();
  if (reader) { try { await reader.cancel(); } catch { /* stream already dead */ } }
  if (readLoop) { try { await readLoop; } catch { /* surfaced via lastError */ } readLoop = null; }
  const p = port.value;
  if (p) { try { await p.close(); } catch { /* already closed */ } }
  state.value = 'closed';
}

async function request(): Promise<boolean> {
  if (!serialSupported) throw new Error('Web Serial is unavailable in this browser');
  try {
    port.value = await navigator.serial.requestPort();
    lastError.value = null;
    return true;
  } catch {
    return false;
  }
}

async function beginMonitor(p: SerialPort, baud: number, note: string): Promise<void> {
  state.value = 'opening';
  try {
    await p.open({ baudRate: baud });
  } catch (e) {
    state.value = 'closed';
    lastError.value = (e as Error).message;
    throw e;
  }
  baudRate.value = baud;
  mode.value = 'monitor';
  state.value = 'open';
  deliver('system', `${note} at ${baud} baud`);
  readLoop = pump(p).finally(() => {
    if (mode.value === 'monitor') { mode.value = null; state.value = 'closed'; }
  });
}

function startMonitor(baud: number): Promise<void> {
  return enqueue(async () => {
    const p = port.value;
    if (!p) throw new Error('No port selected');
    if (mode.value === 'monitor') return;
    await beginMonitor(p, baud, 'Connected');
  });
}

function stopMonitor(): Promise<void> {
  return enqueue(teardown);
}

// Web Serial can't reconfigure a live port; buffered output is lost.
function setBaud(baud: number): Promise<void> {
  return enqueue(async () => {
    if (baud === baudRate.value && mode.value === 'monitor') return;
    const p = port.value;
    const wasMonitoring = mode.value === 'monitor';
    if (wasMonitoring) await teardown();
    baudRate.value = baud;
    if (wasMonitoring && p) await beginMonitor(p, baud, 'Reconnected');
  });
}

// esptool-js opens and closes the port itself, so hand it over closed.
function claim<T>(next: PortMode, fn: (raw: SerialPort) => Promise<T>): Promise<T> {
  return enqueue(async () => {
    const p = port.value;
    if (!p) throw new Error('No port selected');
    const wasMonitoring = mode.value === 'monitor';
    const baud = baudRate.value;
    await teardown();
    mode.value = next;
    state.value = 'busy';
    deliver('system', `Monitor released — port handed to ${next}`);
    try {
      return await fn(p);
    } finally {
      mode.value = null;
      state.value = 'closed';
      if (wasMonitoring) {
        try { await beginMonitor(p, baud, 'Monitor resumed'); } catch { /* surfaced as lastError */ }
      }
    }
  });
}

async function write(data: string | Uint8Array): Promise<void> {
  const p = port.value;
  if (!p?.writable) throw new Error('Port is not open for writing');
  const writer = p.writable.getWriter();
  try {
    await writer.write(typeof data === 'string' ? new TextEncoder().encode(data) : data);
  } finally {
    writer.releaseLock();
  }
}

function onLine(fn: (line: LogLine) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

if (serialSupported) {
  navigator.serial.addEventListener('disconnect', (e) => {
    if (e.target !== port.value) return;
    port.value = null;
    mode.value = null;
    state.value = 'closed';
    lastError.value = 'Device disconnected';
    deliver('system', 'Device disconnected');
  });
}

export function useSerialPort() {
  return {
    supported: serialSupported,
    port,
    state,
    mode,
    baudRate,
    lastError,
    request,
    startMonitor,
    stopMonitor,
    setBaud,
    claim,
    write,
    onLine,
  };
}
