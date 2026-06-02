// Unit tests for the `delay` action: suspend on first pass, pass-through on
// resume, duration clamp, and the per-project pending cap. Pure executor logic —
// D1 and the scheduler are stubbed; run with `bun test worker/test/delay.test.ts`.

import { test, expect } from 'bun:test';
import { runAutomation, type RunDeps } from '../src/platform/engine/run';
import type { AutomationRow, AutomationContext, AutomationGraph } from '../src/platform/engine/types';

// Chainable D1 stub. The COUNT(*) query (default scheduleDelay's cap check)
// returns `pendingCount`; everything else is a no-op.
function fakeEnv(pendingCount = 0): any {
  const stmt = (sql: string) => {
    const s: any = {
      bind: () => s,
      run: async () => ({ meta: { changes: 1 } }),
      first: async () => (/count\(\*\)/i.test(sql) ? { n: pendingCount } : null),
      all: async () => ({ results: [] }),
    };
    return s;
  };
  return {
    DB: { prepare: (sql: string) => stmt(sql) },
    SCHEDULER_DO: { idFromName: () => 'x', get: () => ({ reschedule: async () => {}, ensure: async () => {} }) },
  };
}

function row(graph: AutomationGraph): AutomationRow {
  return {
    id: 'auto1', project_id: 'p1', name: 't', enabled: 1,
    trigger_type: 'variable', trigger_config: '{}', actions: '[]',
    graph: JSON.stringify(graph), last_run_at: null,
  };
}

const ctx = (over: Partial<AutomationContext> = {}): AutomationContext =>
  ({ source: 'variable', projectId: 'p1', ts: 1000, depth: 0, ...over });

// trigger → set A → delay 5s → set B
const linearDelay: AutomationGraph = {
  nodes: [
    { id: 't', kind: 'variable', config: {} },
    { id: 'a', kind: 'set_variable', config: { variable: 'A', value: 1 } },
    { id: 'd', kind: 'delay', config: { delay_amount: 5, delay_unit: 'seconds' } },
    { id: 'b', kind: 'set_variable', config: { variable: 'B', value: 2 } },
  ],
  edges: [
    { from: 't', to: 'a' },
    { from: 'a', to: 'd' },
    { from: 'd', to: 'b' },
  ],
};

test('delay suspends the branch on the first pass', async () => {
  const sets: string[] = [];
  const scheduled: { nodeId: string; fireAt: number }[] = [];
  const deps: RunDeps = {
    setVariable: async (v) => { sets.push(v); },
    scheduleDelay: async (_a, nodeId, _c, fireAt) => { scheduled.push({ nodeId, fireAt }); },
  };
  const before = Date.now();
  const res = await runAutomation(fakeEnv(), row(linearDelay), ctx(), deps);

  expect(sets).toEqual(['A']);                 // pre-delay action ran
  expect(scheduled.length).toBe(1);            // one continuation queued
  expect(scheduled[0]!.nodeId).toBe('d');
  expect(scheduled[0]!.fireAt).toBeGreaterThanOrEqual(before + 5000);
  expect(res.status).toBe('ok');
});

test('delay passes through on resume and runs downstream', async () => {
  const sets: string[] = [];
  let scheduledCalls = 0;
  const deps: RunDeps = {
    setVariable: async (v) => { sets.push(v); },
    scheduleDelay: async () => { scheduledCalls++; },
  };
  await runAutomation(fakeEnv(), row(linearDelay), ctx({ entryNodeId: 'd', resumeNodeId: 'd' }), deps);

  expect(sets).toEqual(['B']);                 // only downstream action ran
  expect(scheduledCalls).toBe(0);              // did not re-suspend
});

test('delay clamps to 24h and defaults bad config to 30s', async () => {
  const fires: number[] = [];
  const deps: RunDeps = { setVariable: async () => {}, scheduleDelay: async (_a, _n, _c, f) => { fires.push(f); } };

  const big: AutomationGraph = { nodes: [{ id: 'd', kind: 'delay', config: { delay_amount: 100, delay_unit: 'hours' } }], edges: [] };
  let before = Date.now();
  await runAutomation(fakeEnv(), row(big), ctx({ entryNodeId: 'd' }), deps);
  expect(fires[0]! - before).toBeLessThanOrEqual(86_400_000 + 100);
  expect(fires[0]! - before).toBeGreaterThanOrEqual(86_400_000 - 1000);

  const bad: AutomationGraph = { nodes: [{ id: 'd', kind: 'delay', config: {} }], edges: [] };
  before = Date.now();
  await runAutomation(fakeEnv(), row(bad), ctx({ entryNodeId: 'd' }), deps);
  expect(fires[1]! - before).toBeGreaterThanOrEqual(29_000);
  expect(fires[1]! - before).toBeLessThanOrEqual(31_000);
});

test('default scheduleDelay errors past the pending cap', async () => {
  const res = await runAutomation(fakeEnv(100), row(linearDelay), ctx(), { setVariable: async () => {} });
  expect(res.status).toBe('error');
  expect(res.error).toContain('pending delay limit');
});
