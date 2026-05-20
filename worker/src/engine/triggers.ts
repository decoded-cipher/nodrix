// Pure variable-trigger evaluation. No I/O — trivially testable and safe to call
// on the telemetry hot path. Schedule/solar timing lives in ./schedule.ts.

import type { VariableTriggerConfig } from './types';

// Variable condition. `prev` is the value held before this ingest, used for
// edge-triggering so a continuously-true condition fires only on entry.
export function matchVariableCondition(
  cfg: VariableTriggerConfig,
  value: unknown,
  prev: unknown
): boolean {
  if (!cfg || typeof cfg.variable !== 'string') return false;

  if (cfg.operator === 'changed') {
    return !valuesEqual(prev, value);
  }

  const nowTrue = evalOp(cfg, value);
  if (cfg.mode === 'always') return nowTrue;

  // edge (default): false -> true transition only.
  const beforeTrue = evalOp(cfg, prev);
  return nowTrue && !beforeTrue;
}

function evalOp(cfg: VariableTriggerConfig, v: unknown): boolean {
  if (v === undefined || v === null) return false;
  const target = cfg.value;
  switch (cfg.operator) {
    case '==': return looseEqual(v, target);
    case '!=': return !looseEqual(v, target);
    case '>': return toNum(v) > toNum(target);
    case '<': return toNum(v) < toNum(target);
    case '>=': return toNum(v) >= toNum(target);
    case '<=': return toNum(v) <= toNum(target);
    default: return false;
  }
}

function toNum(v: unknown): number {
  if (typeof v === 'boolean') return v ? 1 : 0;
  const n = Number(v);
  return Number.isNaN(n) ? NaN : n;
}

function looseEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'boolean' || typeof b === 'boolean') {
    return Boolean(a) === Boolean(b);
  }
  if (typeof a === 'number' || typeof b === 'number') {
    return toNum(a) === toNum(b);
  }
  return String(a) === String(b);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === undefined || a === null) return false;  // first-ever value counts as a change
  return looseEqual(a, b);
}
