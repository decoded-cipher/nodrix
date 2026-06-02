// Domain 9 (shared/blocks): the pure graph helpers the engine + editor rely on —
// save-time validation (unknown kinds, dangling edges, cycle rejection), the
// trigger_kinds membership string the scheduler/DO query by, and the legacy
// linear-graph builder. Run with `bun test worker/test/graph.test.ts`.

import { test, expect } from 'bun:test';
import {
  graphError,
  serializeTriggerKinds,
  buildLinearGraph,
  isGraph,
  triggerNodes,
  type AutomationGraph,
  type GraphNode,
  type GraphEdge,
} from '@nodrix/blocks-shared';

const g = (nodes: GraphNode[], edges: GraphEdge[] = []): AutomationGraph => ({ nodes, edges });

test('graphError accepts a valid DAG and an empty draft', () => {
  expect(graphError(g(
    [{ id: 't', kind: 'variable', config: {} }, { id: 'a', kind: 'set_variable', config: {} }],
    [{ from: 't', to: 'a' }],
  ))).toBeNull();
  expect(graphError(g([]))).toBeNull();
});

test('graphError rejects unknown kinds, dangling edges, and cycles', () => {
  expect(graphError(g([{ id: 'x', kind: 'bogus', config: {} }]))).toContain('Unknown');
  expect(graphError(g([{ id: 't', kind: 'variable', config: {} }], [{ from: 't', to: 'missing' }]))).toContain('missing node');
  expect(graphError(g(
    [{ id: 'a', kind: 'set_variable', config: {} }, { id: 'b', kind: 'set_variable', config: {} }],
    [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }],
  ))).toContain('loop');
});

test('serializeTriggerKinds builds the dedup ",kind," membership string', () => {
  const s = serializeTriggerKinds(g([
    { id: 't1', kind: 'variable', config: {} },
    { id: 't2', kind: 'schedule', config: {} },
    { id: 't3', kind: 'variable', config: {} },
    { id: 'a', kind: 'set_variable', config: {} },
  ]));
  expect(s.startsWith(',') && s.endsWith(',')).toBe(true);
  expect(s).toContain(',variable,');
  expect(s).toContain(',schedule,');
  expect(s.split(',').filter((k) => k === 'variable')).toHaveLength(1); // deduped
  expect(serializeTriggerKinds(g([{ id: 'a', kind: 'set_variable', config: {} }]))).toBe('');
});

test('buildLinearGraph chains valid actions and drops invalid ones', () => {
  const graph = buildLinearGraph('variable', { variable: 'temp' }, [
    { type: 'set_variable', variable: 'x', value: 1 },
    { type: 'bogus_action' },
    { type: 'emit_event', event: 'e' },
  ]);
  expect(isGraph(graph)).toBe(true);
  expect(triggerNodes(graph)).toHaveLength(1);
  expect(graph.nodes).toHaveLength(3); // trigger + 2 valid actions (bogus dropped)
  expect(graph.edges).toHaveLength(2);
});
