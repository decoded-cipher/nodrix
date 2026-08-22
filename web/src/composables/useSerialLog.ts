import { computed, ref, shallowRef } from 'vue';
import { useSerialPort, type LogLine, type LogSource } from './useSerialPort';

export type LogLevel = 'info' | 'ok' | 'warn' | 'error' | 'system';
export type LogEntry = {
  id: number;
  at: number;
  source: LogSource;
  text: string;
  level: LogLevel;
  tag?: string;
};

const MAX_ENTRIES = 2000;
// A wrong baud rate reads as replacement and control characters, not silence.
const GARBLED_RATIO = 0.2;
const GARBLED_CHARS = /[\uFFFD\u0000-\u0008\u000B\u000C\u000E-\u001F]/g;

const BOOT_PREFIXES = ['rst:0x', 'ets ', 'load 0x', 'configsip:', 'clk_drv:', 'mode:DIO', 'entry 0x'];

const NODRIX_LEVELS: [RegExp, LogLevel][] = [
  [/^no wifi network set/, 'error'],
  [/^wifi connected/, 'ok'],
  [/^connected$/, 'ok'],
  [/^disconnected$/, 'warn'],
  [/^server error/, 'error'],
  [/^unhandled control/, 'warn'],
  [/^key dropped/, 'warn'],
  [/^telemetry buffer full/, 'warn'],
];

function classify(line: LogLine, id: number): LogEntry {
  const base = { id, at: line.at, source: line.source, text: line.text };
  if (line.source === 'flash') return { ...base, level: 'info', tag: 'flash' };
  if (line.source === 'system') return { ...base, level: 'system' };

  const nodrix = /^\[nodrix\]\s*(.*)$/.exec(line.text);
  if (nodrix) {
    const body = nodrix[1] ?? '';
    const match = NODRIX_LEVELS.find(([re]) => re.test(body));
    return { ...base, text: body, level: match?.[1] ?? 'info', tag: 'nodrix' };
  }

  const idf = /^([EWIDV])\s\(\d+\)\s/.exec(line.text);
  if (idf) {
    const level: LogLevel = idf[1] === 'E' ? 'error' : idf[1] === 'W' ? 'warn' : 'info';
    return { ...base, level, tag: 'esp' };
  }

  if (BOOT_PREFIXES.some((p) => line.text.startsWith(p))) return { ...base, level: 'system', tag: 'boot' };

  return { ...base, level: 'info' };
}

const entries = shallowRef<LogEntry[]>([]);
const paused = ref(false);
let held: LogEntry[] = [];
let queue: LogEntry[] = [];
let frame: number | null = null;
let nextId = 1;

function cap(list: LogEntry[]): LogEntry[] {
  return list.length > MAX_ENTRIES ? list.slice(list.length - MAX_ENTRIES) : list;
}

// A board at 115200 can outrun per-line reactivity, so commit once a frame.
function schedule() {
  if (frame !== null) return;
  frame = requestAnimationFrame(() => {
    frame = null;
    if (!queue.length) return;
    entries.value = cap(entries.value.concat(queue));
    queue = [];
  });
}

useSerialPort().onLine((line) => {
  const entry = classify(line, nextId++);
  if (paused.value) {
    held = cap(held.concat(entry));
    return;
  }
  queue.push(entry);
  schedule();
});

const garbled = computed(() => {
  const recent = entries.value.filter((e) => e.source === 'device').slice(-20);
  if (recent.length < 5) return false;
  const text = recent.map((e) => e.text).join('');
  if (!text.length) return false;
  return (text.match(GARBLED_CHARS) ?? []).length / text.length > GARBLED_RATIO;
});

function setPaused(on: boolean) {
  paused.value = on;
  if (!on && held.length) {
    entries.value = cap(entries.value.concat(held));
    held = [];
  }
}

function clear() {
  entries.value = [];
  queue = [];
  held = [];
}

function toText(): string {
  return entries.value
    .map((e) => `${new Date(e.at).toISOString().slice(11, 23)}  ${e.tag ? `[${e.tag}] ` : ''}${e.text}`)
    .join('\n');
}

export function useSerialLog() {
  return { entries, paused, garbled, setPaused, clear, toText };
}
