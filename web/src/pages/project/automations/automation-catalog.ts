// Catalog + formatting helpers for automations. Trigger metadata drives the
// picker, the editor header, and the card summaries. Keeping the human-readable
// summary logic here means cards and the editor stay in sync.

import type { AutomationTriggerType, VariableOperator, Action } from '../../../types';

export type TriggerSpec = {
  key: AutomationTriggerType;
  title: string;
  desc: string;
  icon: string; // 24x24 outline path
};

// Heroicons-style outline paths.
const ICON = {
  variable: 'M21 7.5 12 3 3 7.5m18 0L12 12m9-4.5v9L12 21m0-9L3 7.5m9 4.5v9M3 7.5v9L12 21',
  scene: 'M15 11.25h-1.5m0 0V9.75m0 1.5h-1.5m1.5 0v-1.5M10.5 21h.75m-1.5-12.75V6.75A2.25 2.25 0 0 1 12 4.5a2.25 2.25 0 0 1 2.25 2.25V9m-4.5 0H7.5a1.5 1.5 0 0 0-1.5 1.5v8.25A2.25 2.25 0 0 0 8.25 21h7.5A2.25 2.25 0 0 0 18 18.75V10.5a1.5 1.5 0 0 0-1.5-1.5h-2.25M9.75 9h4.5',
  clock: 'M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  sun: 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
  bell: 'M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0',
} as const;

export const TRIGGERS: readonly TriggerSpec[] = [
  { key: 'variable',       title: 'Variable',       desc: 'Run when the value of a variable meets a condition.',           icon: ICON.variable },
  { key: 'scene',          title: 'Scene',          desc: 'Run on demand with a Run button — no condition.',               icon: ICON.scene },
  { key: 'schedule',       title: 'Schedule',       desc: 'Run at a specific time of day, on chosen weekdays.',            icon: ICON.clock },
  { key: 'sunset_sunrise', title: 'Sunset / Sunrise', desc: 'Run relative to local sunrise or sunset.',                   icon: ICON.sun },
  { key: 'event',          title: 'Event',          desc: 'Run when a named event is posted by hardware or an automation.', icon: ICON.bell },
];

export function triggerSpec(key: AutomationTriggerType): TriggerSpec {
  return TRIGGERS.find((t) => t.key === key) ?? TRIGGERS[0]!;
}

export const OPERATORS: readonly { value: VariableOperator; label: string; short: string }[] = [
  { value: '>',  label: 'is greater than', short: '>' },
  { value: '<',  label: 'is less than',    short: '<' },
  { value: '>=', label: 'is at least',     short: '≥' },
  { value: '<=', label: 'is at most',      short: '≤' },
  { value: '==', label: 'equals',          short: '=' },
  { value: '!=', label: 'does not equal',  short: '≠' },
  { value: 'changed', label: 'changes',    short: 'changes' },
];

export const ACTION_TYPES = [
  { value: 'set_variable', label: 'Set variable' },
  { value: 'call_integration', label: 'Call integration' },
  { value: 'emit_event', label: 'Emit event' },
] as const;

const DAY_LABEL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

type Resolvers = {
  variableLabel?: (key: string) => string;
};

// Human-readable "When …" string for a trigger. Falls back to keys when no
// label resolver is supplied.
export function triggerSummary(
  type: AutomationTriggerType,
  config: Record<string, unknown> | null | undefined,
  r: Resolvers = {}
): string {
  const cfg = (config ?? {}) as Record<string, unknown>;
  const varLabel = r.variableLabel ?? ((k: string) => k);

  switch (type) {
    case 'variable': {
      const v = varLabel(String(cfg.variable ?? '?'));
      const op = OPERATORS.find((o) => o.value === cfg.operator);
      if (cfg.operator === 'changed') return `When ${v} changes`;
      return `When ${v} ${op?.label ?? cfg.operator} ${fmtVal(cfg.value)}`;
    }
    case 'scene':
      return 'Run manually';
    case 'schedule': {
      const days = Array.isArray(cfg.days) ? (cfg.days as number[]) : [];
      const when = days.length === 0 ? 'Every day' : days.slice().sort().map((d) => DAY_LABEL[d]).join(', ');
      return `${when} at ${cfg.time ?? '—'}`;
    }
    case 'sunset_sunrise': {
      const ev = cfg.event === 'sunrise' ? 'sunrise' : 'sunset';
      const off = Number(cfg.offset_minutes ?? 0);
      const offStr = off === 0 ? '' : off > 0 ? ` +${off} min` : ` ${off} min`;
      return `At ${ev}${offStr}`;
    }
    case 'event':
      return cfg.event ? `On event "${cfg.event}"` : 'On event';
    default:
      return '';
  }
}

// ─── Rule-flow chips ──────────────────────────────────────────────────────────
// Compact trigger + action nodes for the rule-flow card and editor preview.

const ACTION_ICON = {
  set_variable: 'M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75',
  call_integration: 'm3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z',
  emit_event: 'M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46',
} as const;

export type FlowChip = { icon: string; label: string };

export type ChipResolvers = {
  variableLabel?: (key: string) => string;
  integration?: (id: string) => { name: string; icon: string } | undefined;
};

// Short trigger label for a chip — no leading "When/At/On" so it reads inline.
export function triggerChipLabel(
  type: AutomationTriggerType,
  config: Record<string, unknown> | null | undefined,
  r: ChipResolvers = {}
): string {
  const cfg = (config ?? {}) as Record<string, unknown>;
  const varLabel = r.variableLabel ?? ((k: string) => k);

  switch (type) {
    case 'variable': {
      const v = varLabel(String(cfg.variable ?? '?'));
      if (cfg.operator === 'changed') return `${v} changed`;
      const op = OPERATORS.find((o) => o.value === cfg.operator);
      return `${v} ${op?.short ?? cfg.operator} ${fmtVal(cfg.value)}`;
    }
    case 'scene':
      return 'Manual';
    case 'schedule': {
      const days = Array.isArray(cfg.days) ? (cfg.days as number[]) : [];
      const when = days.length === 0 ? 'Daily' : days.slice().sort().map((d) => DAY_LABEL[d]).join(' ');
      return `${cfg.time ?? '—'} · ${when}`;
    }
    case 'sunset_sunrise': {
      const ev = cfg.event === 'sunrise' ? 'Sunrise' : 'Sunset';
      const off = Number(cfg.offset_minutes ?? 0);
      return off === 0 ? ev : `${ev} ${off > 0 ? '+' : ''}${off}m`;
    }
    case 'event':
      return cfg.event ? `"${cfg.event}"` : 'event';
    default:
      return '';
  }
}

// Action list → flow chips (icon + label). call_integration borrows the
// connector's own icon via the resolver.
export function actionChips(actions: unknown[] | null | undefined, r: ChipResolvers = {}): FlowChip[] {
  if (!Array.isArray(actions)) return [];
  const varLabel = r.variableLabel ?? ((k: string) => k);
  return actions.map((raw) => {
    const a = raw as Partial<Action> & Record<string, unknown>;
    if (a.type === 'set_variable') {
      return { icon: ACTION_ICON.set_variable, label: `${varLabel(String(a.variable ?? '?'))} = ${fmtVal(a.value)}` };
    }
    if (a.type === 'call_integration') {
      const meta = r.integration?.(String(a.integration_id ?? ''));
      return { icon: meta?.icon ?? ACTION_ICON.call_integration, label: meta?.name ?? 'an integration' };
    }
    if (a.type === 'emit_event') {
      return { icon: ACTION_ICON.emit_event, label: `Emit "${a.event ?? '?'}"` };
    }
    return { icon: ACTION_ICON.call_integration, label: 'Unknown action' };
  });
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  return String(v);
}
