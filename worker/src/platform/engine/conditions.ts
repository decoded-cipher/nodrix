// Condition node evaluation, keyed by kind. Returns the boolean that selects the
// node's true/false output port. Adding a condition = register a handler here and
// add its manifest to @nodrix/blocks-shared.

import { matchVariableCondition } from './triggers';
import type { AutomationContext, VariableOperator } from './types';

export type ConditionDeps = {
  getVariable: (variable: string) => Promise<unknown>;
};

type CondArgs = {
  ctx: AutomationContext;
  config: Record<string, unknown>;
  deps: ConditionDeps;
};

const HANDLERS: Record<string, (a: CondArgs) => Promise<boolean>> = {
  if_variable: async ({ config, deps }) => {
    const variable = String(config.variable ?? '');
    const current = await deps.getVariable(variable);
    return matchVariableCondition(
      {
        variable,
        operator: config.operator as VariableOperator,
        value: config.value as number | string | boolean,
        mode: 'always',
      },
      current,
      undefined
    );
  },

  time_window: async ({ ctx, config }) => withinTimeWindow(config, ctx.ts),
};

export async function evalCondition(kind: string, args: CondArgs): Promise<boolean> {
  const handler = HANDLERS[kind];
  return handler ? handler(args) : true; // unknown condition: don't block the flow
}

// True if `tsSec` falls within [from, to] (wall time in `tz`) on the chosen
// weekdays (empty = every day). Handles windows that wrap past midnight.
function withinTimeWindow(config: Record<string, unknown>, tsSec: number): boolean {
  const tz = typeof config.tz === 'string' && config.tz ? config.tz : 'UTC';
  const from = toMinutes(String(config.from ?? '00:00'));
  const to = toMinutes(String(config.to ?? '23:59'));
  const days = Array.isArray(config.days) ? (config.days as number[]) : [];

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(tsSec * 1000));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const nowMin = Number(get('hour')) * 60 + Number(get('minute'));
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));

  const inDays = days.length === 0 || days.includes(weekday);
  const inTime = from <= to ? nowMin >= from && nowMin <= to : nowMin >= from || nowMin <= to;
  return inDays && inTime;
}

function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':');
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}
