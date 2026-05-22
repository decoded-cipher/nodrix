// Catalog of the four built-in widgets. Drives the palette + config form +
// the default props inserted when a widget is added to a dashboard.

import type { WidgetType } from '../types';

export type FieldType = 'string' | 'number' | 'boolean' | 'variable' | 'select' | 'series' | 'markers';

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
// header. Lucide-style outlines, 24x24, ~1.75 stroke so they read well at
// small sizes.
const ICON_VALUE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9.5h4"/><path d="M7 14.5h10" stroke-width="2.5"/></svg>`;
const ICON_GAUGE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17a9 9 0 0 1 18 0"/><path d="M12 17l4.5-4.5"/><circle cx="12" cy="17" r="1.6" fill="currentColor" stroke="none"/></svg>`;
const ICON_CHART = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3.5-3.5 3 2L19 6"/><circle cx="19" cy="6" r="1.4" fill="currentColor" stroke="none"/></svg>`;
const ICON_TOGGLE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="7" width="19" height="10" rx="5"/><circle cx="16.5" cy="12" r="2.5" fill="currentColor" stroke="none"/></svg>`;
const ICON_PUSH = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5" fill="currentColor" stroke="none"/></svg>`;
const ICON_SLIDER = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h18"/><circle cx="14" cy="12" r="3.25" fill="currentColor" stroke="none"/></svg>`;
const ICON_MAP = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s-6-5.3-6-10a6 6 0 0 1 12 0c0 4.7-6 10-6 10z"/><circle cx="12" cy="11" r="2.25" fill="currentColor" stroke="none"/></svg>`;

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
    defaultProps: { title: '', variable: '', unit: '' },
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'variable', label: 'Variable', type: 'variable' },
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
    defaultProps: { title: '', variable: '', min: 0, max: 100 },
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'variable', label: 'Variable', type: 'variable' },
      { key: 'min', label: 'Min', type: 'number' },
      { key: 'max', label: 'Max', type: 'number' },
    ],
  },
  {
    type: 'iot-chart',
    label: 'Chart',
    description: 'Time-series chart with one or more series.',
    category: 'Monitor',
    dataTypes: ['Numeric time series'],
    whenToUse: 'Plot trends for one or more metrics over a time window (15m to 24h). Good for spotting drift, spikes, or correlations.',
    icon: ICON_CHART,
    defaultSize: { w: 6, h: 3 },
    defaultProps: { title: '', window: '1h', chartType: 'line', zoom: false, series: [] },
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'window', label: 'Window', type: 'select', options: ['15m', '1h', '6h', '24h'] },
      { key: 'chartType', label: 'Type', type: 'select', options: ['line', 'area', 'bar', 'stepline'] },
      { key: 'zoom', label: 'Enable zoom', type: 'boolean' },
      { key: 'series', label: 'Series', type: 'series' },
    ],
  },
  // (series items are { variable, label, color })
  {
    type: 'iot-map',
    label: 'Map',
    description: 'Geographic markers from static coords or live lat/lng variables.',
    category: 'Monitor',
    dataTypes: ['Lat/Lng pairs', 'Static coordinates'],
    whenToUse:
      'Plot device or asset locations on a map — fleet tracking, or fixed sensors across a site. Each marker can sit at fixed coordinates or follow a lat/lng variable pair, with an optional value shown on click.',
    icon: ICON_MAP,
    defaultSize: { w: 6, h: 4 },
    defaultProps: { title: '', basemap: 'auto', autoFit: true, zoom: 13, centerLat: 0, centerLng: 0, markers: [] },
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'basemap', label: 'Basemap', type: 'select', options: ['auto', 'streets', 'light', 'dark', 'satellite'] },
      { key: 'autoFit', label: 'Auto-fit to markers', type: 'boolean' },
      { key: 'zoom', label: 'Default zoom', type: 'number' },
      { key: 'centerLat', label: 'Center lat', type: 'number' },
      { key: 'centerLng', label: 'Center lng', type: 'number' },
      { key: 'markers', label: 'Markers', type: 'markers' },
    ],
  },
  // (marker items are { source, lat, lng, latVar, lngVar, label, valueVar, color })
  {
    type: 'iot-toggle',
    label: 'Toggle',
    description: 'Send an on/off command to a device.',
    category: 'Control',
    dataTypes: ['Boolean command'],
    whenToUse: 'Send an on/off command to a device — relays, switches, actuators. Reflects the latest reported state.',
    icon: ICON_TOGGLE,
    defaultSize: { w: 3, h: 2 },
    defaultProps: { title: '', variable: '', onValue: 'on', offValue: 'off' },
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'variable', label: 'Variable', type: 'variable' },
      { key: 'onValue', label: 'On value', type: 'string' },
      { key: 'offValue', label: 'Off value', type: 'string' },
    ],
  },
  {
    type: 'iot-push',
    label: 'Push',
    description: 'Fire a one-shot command.',
    category: 'Control',
    dataTypes: ['Momentary command'],
    whenToUse: 'Trigger a one-shot action — restart a device, run a scene, reset a counter. No persistent state; each press sends the command once.',
    icon: ICON_PUSH,
    defaultSize: { w: 3, h: 2 },
    defaultProps: { title: '', variable: '', value: '', label: '' },
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'variable', label: 'Variable', type: 'variable' },
      { key: 'value', label: 'Payload value', type: 'string' },
      { key: 'label', label: 'Button label (optional)', type: 'string' },
    ],
  },
  {
    type: 'iot-slider',
    label: 'Slider',
    description: 'Set a numeric value within a range.',
    category: 'Control',
    dataTypes: ['Numeric command'],
    whenToUse: 'Set a continuous numeric value — brightness, fan speed, setpoint, volume. Sends the command on release; reflects reported state via the chosen metric.',
    icon: ICON_SLIDER,
    defaultSize: { w: 4, h: 2 },
    defaultProps: { title: '', variable: '', orientation: 'horizontal', min: 0, max: 100, step: 1, unit: '' },
    fields: [
      { key: 'title', label: 'Title', type: 'string' },
      { key: 'variable', label: 'Variable', type: 'variable' },
      { key: 'orientation', label: 'Orientation', type: 'select', options: ['horizontal', 'vertical'] },
      { key: 'min', label: 'Min', type: 'number' },
      { key: 'max', label: 'Max', type: 'number' },
      { key: 'step', label: 'Step', type: 'number' },
      { key: 'unit', label: 'Unit', type: 'string' },
    ],
  },
];

export function specFor(type: WidgetType): WidgetSpec {
  const s = CATALOG.find((c) => c.type === type);
  if (!s) throw new Error(`Unknown widget type: ${type}`);
  return s;
}
