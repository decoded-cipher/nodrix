// Catalog of the four built-in widgets. Drives the palette + config form +
// the default props inserted when a widget is added to a dashboard.

import type { WidgetType } from '../types';

export type FieldType = 'string' | 'number' | 'device' | 'select' | 'series';

export type FieldDef = {
  key: string;
  label: string;
  type: FieldType;
  options?: ReadonlyArray<string>;
  default?: unknown;
};

export type WidgetSpec = {
  type: WidgetType;
  label: string;
  description: string;
  defaultSize: { w: number; h: number };
  defaultProps: Record<string, unknown>;
  fields: ReadonlyArray<FieldDef>;
};

export const CATALOG: ReadonlyArray<WidgetSpec> = [
  {
    type: 'iot-value',
    label: 'Value',
    description: 'Latest reading of one metric.',
    defaultSize: { w: 3, h: 2 },
    defaultProps: { title: '', device: '', metric: '', unit: '' },
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'device', label: 'Device', type: 'device' },
      { key: 'metric', label: 'Metric', type: 'string' },
      { key: 'unit', label: 'Unit', type: 'string' },
    ],
  },
  {
    type: 'iot-gauge',
    label: 'Gauge',
    description: 'Arc gauge with min/max bounds.',
    defaultSize: { w: 3, h: 3 },
    defaultProps: { title: '', device: '', metric: '', min: 0, max: 100 },
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'device', label: 'Device', type: 'device' },
      { key: 'metric', label: 'Metric', type: 'string' },
      { key: 'min', label: 'Min', type: 'number' },
      { key: 'max', label: 'Max', type: 'number' },
    ],
  },
  {
    type: 'iot-chart',
    label: 'Chart',
    description: 'Line chart with one or more series.',
    defaultSize: { w: 6, h: 3 },
    defaultProps: { title: '', window: '1h', series: [] },
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'window', label: 'Window', type: 'select', options: ['15m', '1h', '6h', '24h'] },
      { key: 'series', label: 'Series', type: 'series' },
    ],
  },
  {
    type: 'iot-toggle',
    label: 'Toggle',
    description: 'Send an on/off command to a device.',
    defaultSize: { w: 3, h: 2 },
    defaultProps: { title: '', device: '', command: '', onValue: 'on', offValue: 'off' },
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'device', label: 'Device', type: 'device' },
      { key: 'command', label: 'Command name', type: 'string' },
      { key: 'onValue', label: 'On value', type: 'string' },
      { key: 'offValue', label: 'Off value', type: 'string' },
    ],
  },
];

export function specFor(type: WidgetType): WidgetSpec {
  const s = CATALOG.find((c) => c.type === type);
  if (!s) throw new Error(`Unknown widget type: ${type}`);
  return s;
}
