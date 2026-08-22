import { computed, type ComputedRef } from 'vue';
import { useSerialLog, type LogEntry } from './useSerialLog';

export type Diagnosis = {
  tone: 'ok' | 'warn' | 'error';
  headline: string;
  detail?: string;
};

type Rule = { re: RegExp; build: (m: RegExpMatchArray) => Diagnosis };

const RULES: Rule[] = [
  {
    re: /^no wifi network set/,
    build: () => ({
      tone: 'error',
      headline: 'No Wi-Fi network configured',
      detail: 'The sketch never called addAP(), so it has nothing to join.',
    }),
  },
  {
    re: /^connect refused/,
    build: () => ({
      tone: 'error',
      headline: 'The server refused the connection',
      detail: 'The socket never opened once. The token is wrong, or the host is.',
    }),
  },
  {
    re: /-> 401/,
    build: () => ({ tone: 'error', headline: 'Token rejected', detail: 'This token is not valid for this instance.' }),
  },
  {
    re: /-> 403/,
    build: () => ({ tone: 'error', headline: 'Token has no access to this project' }),
  },
  {
    re: /-> 404/,
    build: () => ({ tone: 'error', headline: 'No such endpoint', detail: 'The host is probably wrong.' }),
  },
  {
    re: /-> 429/,
    build: () => ({ tone: 'warn', headline: 'Rate limited', detail: 'The board is sending faster than the instance accepts.' }),
  },
  {
    re: /-> -\d+ \(no connection/,
    build: () => ({
      tone: 'error',
      headline: "Can't reach the server",
      detail: 'DNS, TLS or the network dropped it before any reply came back.',
    }),
  },
  {
    re: /^socket error/,
    build: () => ({ tone: 'error', headline: 'Socket error' }),
  },
  {
    re: /^server error:\s*(\S+)/,
    build: (m) => ({ tone: 'error', headline: `Server rejected the message`, detail: `It replied with ${m[1]}.` }),
  },
  {
    re: /^connected$/,
    build: () => ({ tone: 'ok', headline: 'Connected' }),
  },
  {
    re: /^disconnected$/,
    build: () => ({ tone: 'warn', headline: 'Disconnected', detail: 'The link was up and dropped. It will retry.' }),
  },
];

function match(entry: LogEntry): Diagnosis | null {
  if (entry.tag !== 'nodrix') return null;
  for (const rule of RULES) {
    const m = entry.text.match(rule.re);
    if (m) return rule.build(m);
  }
  return null;
}

// Wi-Fi state is separate from cloud state: knowing the network is up is what
// turns "disconnected" into a statement about the server rather than the radio.
function wifiUp(entries: LogEntry[]): boolean {
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (e.tag === 'nodrix' && /^wifi connected/.test(e.text)) return true;
  }
  return false;
}

export function diagnose(list: LogEntry[]): Diagnosis | null {
  for (let i = list.length - 1; i >= 0; i--) {
    const found = match(list[i]!);
    if (!found) continue;
    if (found.tone !== 'ok' && wifiUp(list)) {
      return { ...found, detail: `Wi-Fi is up. ${found.detail ?? ''}`.trim() };
    }
    return found;
  }
  return null;
}

export function useSerialDiagnosis(): ComputedRef<Diagnosis | null> {
  const { entries } = useSerialLog();
  return computed(() => diagnose(entries.value));
}
