// Formatting helpers for automations: the human-readable summary/chip logic that
// keeps cards and the editor in sync. Block metadata (labels, icons, kinds) is
// sourced from the shared block catalog — the single source of truth — so adding
// a trigger/action is a manifest folder, not an edit here.

import {
  TRIGGER_CATALOG,
  ACTION_CATALOG,
  triggerSpec as triggerManifest,
  actionSpec as actionManifest,
} from '@nodrix/blocks-shared';
import type { AutomationTriggerType, VariableOperator, Action } from '../../../types';

export type TriggerSpec = {
  key: AutomationTriggerType;
  title: string;
  desc: string;
  icon: string; // 24x24 outline path
};

// Picker / editor-header metadata, derived from the shared catalog.
export const TRIGGERS: readonly TriggerSpec[] = TRIGGER_CATALOG.map((m) => ({
  key: m.kind as AutomationTriggerType,
  title: m.label,
  desc: m.description,
  icon: m.icon,
}));

export function triggerSpec(key: AutomationTriggerType): TriggerSpec {
  const m = triggerManifest(key);
  return { key: m.kind as AutomationTriggerType, title: m.label, desc: m.description, icon: m.icon };
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

export const ACTION_TYPES: readonly { value: string; label: string }[] = ACTION_CATALOG.map((m) => ({
  value: m.kind,
  label: m.label,
}));

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
// Action icons come from the shared catalog (actionManifest(kind).icon).

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
      return { icon: actionManifest('set_variable').icon, label: `${varLabel(String(a.variable ?? '?'))} = ${fmtVal(a.value)}` };
    }
    if (a.type === 'call_integration') {
      const meta = r.integration?.(String(a.integration_id ?? ''));
      return { icon: meta?.icon ?? actionManifest('call_integration').icon, label: meta?.name ?? 'an integration' };
    }
    if (a.type === 'emit_event') {
      return { icon: actionManifest('emit_event').icon, label: `Emit "${a.event ?? '?'}"` };
    }
    return { icon: actionManifest('call_integration').icon, label: 'Unknown action' };
  });
}

function fmtVal(v: unknown): string {
  if (v === undefined || v === null || v === '') return '—';
  return String(v);
}
