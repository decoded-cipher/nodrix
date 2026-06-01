// Human-readable summaries of a node's config — the single home for per-kind
// display formatting. The web reads these (canvas nodes, list-card chips); it
// passes web-only data (variable labels, integration name/icon) via resolvers
// so nothing about a block's shape is hand-coded outside this package.

import { findBlock } from './index';

export type SummaryResolvers = {
  variableLabel?: (key: string) => string;
  integration?: (id: string) => { name: string; kindLabel?: string; icon?: string } | undefined;
};

const OP: Record<string, string> = { '>': '>', '<': '<', '>=': '≥', '<=': '≤', '==': '=', '!=': '≠' };
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Up to two short lines describing a node's configuration.
export function blockLines(kind: string, config: Record<string, unknown>, r: SummaryResolvers = {}): string[] {
  const c = config ?? {};
  const s = (v: unknown) => (v === undefined || v === null || v === '' ? '' : String(v));
  const vl = r.variableLabel ?? ((k: string) => k);
  const out: string[] = [];

  switch (kind) {
    case 'variable':
      out.push(c['operator'] === 'changed'
        ? `${vl(s(c['variable'])) || '?'} changed`
        : `${vl(s(c['variable'])) || '?'} ${OP[s(c['operator'])] ?? s(c['operator'])} ${s(c['value'])}`.trim());
      {
        const mode = c['mode'] === 'always' ? 'every reading' : 'on entry';
        const cd = Number(c['cooldown_seconds'] ?? 0);
        out.push(cd > 0 ? `${mode} · ${cd}s cooldown` : mode);
      }
      break;
    case 'schedule':
      out.push(c['time'] ? `at ${s(c['time'])}` : 'no time set');
      {
        const days = Array.isArray(c['days']) ? (c['days'] as number[]) : [];
        out.push(days.length === 0 ? 'every day' : days.slice().sort().map((d) => DAY[d]).join(' '));
      }
      break;
    case 'sunset_sunrise':
      out.push(s(c['event']) || 'sunset');
      {
        const off = Number(c['offset_minutes'] ?? 0);
        if (off) out.push(`${off > 0 ? '+' : ''}${off} min`);
      }
      break;
    case 'event': out.push(c['event'] ? `"${s(c['event'])}"` : 'no event'); break;
    case 'manual': break;
    case 'if_variable':
      out.push(`${vl(s(c['variable'])) || '?'} ${OP[s(c['operator'])] ?? s(c['operator'])} ${s(c['value'])}`.trim());
      break;
    case 'time_window':
      out.push(`${s(c['from']) || '00:00'}–${s(c['to']) || '23:59'}`);
      {
        const days = Array.isArray(c['days']) ? (c['days'] as number[]) : [];
        if (days.length) out.push(days.slice().sort().map((d) => DAY[d]).join(' '));
      }
      break;
    case 'set_variable': out.push(`${vl(s(c['variable'])) || '?'} = ${s(c['value']) || '—'}`); break;
    case 'emit_event': out.push(c['event'] ? `"${s(c['event'])}"` : 'no event'); break;
    case 'call_integration': {
      const i = r.integration?.(s(c['integration_id']));
      out.push(i?.name ?? 'no integration');
      if (i?.kindLabel) out.push(i.kindLabel);
      break;
    }
  }
  return out.filter(Boolean);
}

// A compact { icon, label } chip for a node: manifest icon + first summary line,
// except call_integration borrows the integration's own icon when resolvable.
export function blockChip(kind: string, config: Record<string, unknown>, r: SummaryResolvers = {}): { icon: string; label: string } {
  const manifest = findBlock(kind);
  const lines = blockLines(kind, config, r);
  let icon = manifest?.icon ?? '';
  if (kind === 'call_integration') {
    const i = r.integration?.(String((config ?? {})['integration_id'] ?? ''));
    if (i?.icon) icon = i.icon;
  }
  return { icon, label: lines[0] || manifest?.label || kind };
}
