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

export type WidgetCategory = 'Monitor' | 'Control';

export type WidgetSpec = {
  type: WidgetType;
  label: string;
  description: string;
  category: WidgetCategory;
  dataTypes: ReadonlyArray<string>;
  whenToUse: string;
  icon: string;
  defaultSize: { w: number; h: number };
  defaultProps: Record<string, unknown>;
  fields: ReadonlyArray<FieldDef>;
};

// Order categories appear in the palette.
export const CATEGORY_ORDER: ReadonlyArray<WidgetCategory> = ['Monitor', 'Control'];

// Inline SVG glyphs (stroke=currentColor) used in the palette grid + tooltip
// header. Keep them ~24x24 with no fill so they tint with text-color.
const ICON_VALUE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M5 7h14"/><path d="M9 7v12"/><path d="M5 13h7"/></svg>`;
const ICON_GAUGE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 17a9 9 0 1 1 17 0"/><path d="M12 17l4-5"/><circle cx="12" cy="17" r="1.2" fill="currentColor" stroke="none"/></svg>`;
const ICON_CHART = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4v16h16"/><path d="M7 15l4-5 3 3 5-7"/></svg>`;
const ICON_TOGGLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="10" rx="5"/><circle cx="16" cy="12" r="3" fill="currentColor" stroke="none"/></svg>`;

export const CATALOG: ReadonlyArray<WidgetSpec> = [
  {
    type: 'iot-value',
    label: 'Value',
    description: 'Latest reading of one metric.',
    category: 'Monitor',
    dataTypes: ['Numeric', 'String', 'Boolean'],
    whenToUse: 'Display the most recent reading of a single metric — temperature, pressure, status text.',
    icon: ICON_VALUE,
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
    category: 'Monitor',
    dataTypes: ['Numeric (bounded)'],
    whenToUse: 'Visualize a single bounded value such as battery percentage, fill level, or signal strength.',
    icon: ICON_GAUGE,
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
    category: 'Monitor',
    dataTypes: ['Numeric time series'],
    whenToUse: 'Plot trends for one or more metrics over a time window (15m to 24h). Good for spotting drift, spikes, or correlations.',
    icon: ICON_CHART,
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
    category: 'Control',
    dataTypes: ['Boolean command'],
    whenToUse: 'Send an on/off command to a device — relays, switches, actuators. Reflects the latest reported state.',
    icon: ICON_TOGGLE,
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
