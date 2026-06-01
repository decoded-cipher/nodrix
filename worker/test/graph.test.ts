// Unit tests for the convert-on-read shim: the legacy trigger_config/actions row
// must rebuild into the same linear trigger → action chain the executor walks.

import { expect, test } from 'bun:test';
import { toGraph, entryNode, countActionNodes, outgoingEdges } from '../src/platform/engine/graph';
import type { AutomationRow } from '../src/platform/engine/types';

function row(over: Partial<AutomationRow>): AutomationRow {
  return {
    id: 'au1', project_id: 'p1', name: 'a', enabled: 1,
    trigger_type: 'variable', trigger_config: '{}', actions: '[]', last_run_at: null,
    ...over,
  };
}

test('variable trigger + actions → trigger node and ordered chain', () => {
  const g = toGraph(row({
    trigger_type: 'variable',
    trigger_config: JSON.stringify({ variable: 'temp', operator: '>', value: 30 }),
    actions: JSON.stringify([
      { type: 'set_variable', variable: 'fan', value: 1 },
      { type: 'call_integration', integration_id: 'int1' },
    ]),
  }));

  expect(g.nodes.map((n) => n.kind)).toEqual(['variable', 'set_variable', 'call_integration']);
  expect(entryNode(g)?.kind).toBe('variable');
  expect(countActionNodes(g)).toBe(2);
  // chain: trigger → a0 → a1
  expect(g.edges).toEqual([
    { from: 'trigger', to: 'a0', port: 'out' },
    { from: 'a0', to: 'a1', port: 'out' },
  ]);
  // trigger config preserved, action `type` stripped into kind
  expect(entryNode(g)?.config).toEqual({ variable: 'temp', operator: '>', value: 30 });
  expect(g.nodes[1]?.config).toEqual({ variable: 'fan', value: 1 });
});

test('invalid action kinds are dropped', () => {
  const g = toGraph(row({
    actions: JSON.stringify([
      { type: 'set_variable', variable: 'x', value: 1 },
      { type: 'bogus_action', foo: 1 },
    ]),
  }));
  expect(countActionNodes(g)).toBe(1);
  expect(g.nodes.map((n) => n.kind)).toEqual(['variable', 'set_variable']);
});

test('scene trigger with no actions → single trigger node, no edges', () => {
  const g = toGraph(row({ trigger_type: 'scene', trigger_config: '{}', actions: '[]' }));
  expect(g.nodes.map((n) => n.kind)).toEqual(['scene']);
  expect(g.edges).toEqual([]);
  expect(countActionNodes(g)).toBe(0);
});

test('unknown trigger_type → actions form the entry chain', () => {
  const g = toGraph(row({
    trigger_type: 'not_a_trigger',
    actions: JSON.stringify([{ type: 'emit_event', event: 'boom' }]),
  }));
  expect(entryNode(g)?.kind).toBe('emit_event');
  expect(outgoingEdges(g, 'a0')).toEqual([]);
});
