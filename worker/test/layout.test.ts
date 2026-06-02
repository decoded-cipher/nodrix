// Domain 5 (dashboards): the layout validator (gates stored data + clamps the
// public refresh cadence) and the manifest-driven variable extractor that backs
// the public leak-filter. Pure logic. Run with `bun test worker/test/layout.test.ts`.

import { test, expect } from 'bun:test';
import { validateLayout, variablesFromLayout } from '../src/platform/lib/layout';

const valueWidget = (variable: string) => ({
  id: 'w1', x: 0, y: 0, w: 3, h: 2, type: 'iot-value',
  props: { title: 'T', variable, unit: '°C' },
});

test('accepts a well-formed layout', () => {
  const r = validateLayout({ grid: { columns: 12 }, items: [valueWidget('temp')] });
  expect(r.ok).toBe(true);
});

test('rejects bad grid, non-array items, and unknown widget types', () => {
  expect(validateLayout(null).ok).toBe(false);
  expect(validateLayout({ grid: {}, items: [] }).ok).toBe(false);
  expect(validateLayout({ grid: { columns: 12 }, items: {} }).ok).toBe(false);
  const bad = validateLayout({ grid: { columns: 12 }, items: [{ id: 'x', x: 0, y: 0, w: 1, h: 1, type: 'not-a-widget', props: {} }] });
  expect(bad.ok).toBe(false);
});

test('clamps the public refresh cadence to safe bounds', () => {
  const fast = validateLayout({ grid: { columns: 12 }, items: [], refresh: 1 });
  const slow = validateLayout({ grid: { columns: 12 }, items: [], refresh: 999_999 });
  expect(fast.ok && fast.value.refresh).toBe(5);
  expect(slow.ok && slow.value.refresh).toBe(3600);
});

test('validates the optional mobile override', () => {
  const ok = validateLayout({ grid: { columns: 12 }, items: [valueWidget('t')], mobile: { items: [{ id: 'w1', x: 0, y: 0, w: 2, h: 2 }] } });
  expect(ok.ok).toBe(true);
  const bad = validateLayout({ grid: { columns: 12 }, items: [], mobile: { items: [{ id: 'w1' }] } });
  expect(bad.ok).toBe(false);
});

test('variablesFromLayout extracts the variables a layout references (leak-filter basis)', () => {
  const r = validateLayout({ grid: { columns: 12 }, items: [valueWidget('temperature'), valueWidget('humidity')] });
  expect(r.ok).toBe(true);
  if (r.ok) expect(new Set(variablesFromLayout(r.value))).toEqual(new Set(['temperature', 'humidity']));
});
