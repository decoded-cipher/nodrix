// Run with `bun test worker/test/mcp-coerce.test.ts`.

import { test, expect } from 'bun:test';
import { parseStructured, parseStructuredArray } from '../src/mcp/coerce';

test('parseStructured re-parses a stringified object', () => {
  const graph = { nodes: [{ id: 't1', kind: 'trigger', config: {} }], edges: [] };
  expect(parseStructured(JSON.stringify(graph))).toEqual(graph);
});

test('parseStructured re-parses a stringified array', () => {
  expect(parseStructured('[{"a":1},{"b":2}]')).toEqual([{ a: 1 }, { b: 2 }]);
});

test('parseStructured passes real objects/arrays through untouched', () => {
  const obj = { nodes: [], edges: [] };
  expect(parseStructured(obj)).toBe(obj);
  const arr = [1, 2, 3];
  expect(parseStructured(arr)).toBe(arr);
});

test('parseStructured never mangles a scalar-valued string', () => {
  expect(parseStructured('hello')).toBe('hello');
  expect(parseStructured('123')).toBe('123');
  expect(parseStructured('true')).toBe('true');
});

test('parseStructured returns the original string when JSON is invalid', () => {
  expect(parseStructured('{not valid json')).toBe('{not valid json');
});

test('parseStructured leaves non-strings (incl. null/undefined) alone', () => {
  expect(parseStructured(undefined)).toBeUndefined();
  expect(parseStructured(null)).toBeNull();
  expect(parseStructured(42)).toBe(42);
  expect(parseStructured(false)).toBe(false);
});

test('parseStructuredArray re-parses a stringified array', () => {
  expect(parseStructuredArray('[{"type":"set_variable"}]')).toEqual([{ type: 'set_variable' }]);
});

test('parseStructuredArray re-parses stringified elements within a real array', () => {
  const actions = ['{"type":"emit_event"}', { type: 'set_variable' }];
  expect(parseStructuredArray(actions)).toEqual([{ type: 'emit_event' }, { type: 'set_variable' }]);
});

test('parseStructuredArray returns undefined for non-array input', () => {
  expect(parseStructuredArray(undefined)).toBeUndefined();
  expect(parseStructuredArray('{"not":"an array"}')).toBeUndefined();
  expect(parseStructuredArray('hello')).toBeUndefined();
});
