// Trigger block manifests. Per-kind evaluation lives in the worker engine.

import type { BlockManifest } from './index';

export const TRIGGER_CATALOG = [
  {
    kind: 'variable',
    category: 'trigger',
    label: 'Variable',
    description: 'Run when the value of a variable meets a condition.',
    icon: 'M21 7.5 12 3 3 7.5m18 0L12 12m9-4.5v9L12 21m0-9L3 7.5m9 4.5v9M3 7.5v9L12 21',
    executable: true,
    ports: { out: ['out'] },
    fields: [
      { key: 'variable', label: 'Variable', type: 'variable', required: true },
      {
        key: 'operator',
        label: 'Condition',
        type: 'select',
        options: ['>', '<', '>=', '<=', '==', '!=', 'changed'],
        default: '>',
      },
      { key: 'value', label: 'Value', type: 'text', placeholder: 'value' },
      {
        key: 'mode',
        label: 'Fire mode',
        type: 'select',
        options: ['edge', 'always'],
        default: 'edge',
        hint: 'edge = once on entry; always = every matching reading.',
      },
    ],
  },
  {
    kind: 'scene',
    category: 'trigger',
    label: 'Scene',
    description: 'Run on demand with a Run button — no condition.',
    icon: 'M15 11.25h-1.5m0 0V9.75m0 1.5h-1.5m1.5 0v-1.5M10.5 21h.75m-1.5-12.75V6.75A2.25 2.25 0 0 1 12 4.5a2.25 2.25 0 0 1 2.25 2.25V9m-4.5 0H7.5a1.5 1.5 0 0 0-1.5 1.5v8.25A2.25 2.25 0 0 0 8.25 21h7.5A2.25 2.25 0 0 0 18 18.75V10.5a1.5 1.5 0 0 0-1.5-1.5h-2.25M9.75 9h4.5',
    executable: true,
    ports: { out: ['out'] },
    fields: [],
  },
  {
    kind: 'schedule',
    category: 'trigger',
    label: 'Schedule',
    description: 'Run at a specific time of day, on chosen weekdays.',
    icon: 'M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    executable: true,
    ports: { out: ['out'] },
    fields: [
      { key: 'time', label: 'Time', type: 'time', required: true, default: '08:00' },
      { key: 'days', label: 'Days', type: 'weekdays', hint: 'No days selected = every day.' },
      { key: 'tz', label: 'Timezone', type: 'text', mono: true, placeholder: 'IANA timezone' },
    ],
  },
  {
    kind: 'sunset_sunrise',
    category: 'trigger',
    label: 'Sunset / Sunrise',
    description: 'Run relative to local sunrise or sunset.',
    icon: 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
    executable: true,
    ports: { out: ['out'] },
    fields: [
      { key: 'event', label: 'Event', type: 'select', options: ['sunrise', 'sunset'], default: 'sunset' },
      { key: 'lat', label: 'Latitude', type: 'number', placeholder: 'lat' },
      { key: 'lng', label: 'Longitude', type: 'number', placeholder: 'lng' },
      { key: 'offset_minutes', label: 'Offset (min)', type: 'number', default: 0 },
    ],
  },
  {
    kind: 'event',
    category: 'trigger',
    label: 'Event',
    description: 'Run when a named event is posted by hardware or an automation.',
    icon: 'M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0',
    executable: true,
    ports: { out: ['out'] },
    fields: [
      {
        key: 'event',
        label: 'Event name',
        type: 'text',
        required: true,
        mono: true,
        placeholder: 'event name, e.g. button_pressed',
        hint: 'Matched against POST /v1/events { "event": "…" }.',
      },
    ],
  },
] as const satisfies readonly BlockManifest[];
