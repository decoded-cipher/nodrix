// Condition block manifests. Per-kind evaluation lives in the worker engine.
// Conditions gate the flow: they have `true`/`false` output ports and the
// executor follows only the matching branch.

import type { BlockManifest } from './index';

export const CONDITION_CATALOG = [
  {
    kind: 'if_variable',
    category: 'condition',
    label: 'If variable',
    description: 'Continue down "yes" only when a variable meets the comparison.',
    icon: 'M3.792 2.938A49.069 49.069 0 0 1 12 2.25c2.797 0 5.54.236 8.209.688a1.857 1.857 0 0 1 1.541 1.836v1.044a3 3 0 0 1-.879 2.121l-6.182 6.182a1.5 1.5 0 0 0-.439 1.061v2.927a3 3 0 0 1-1.658 2.684l-1.757.878A.75.75 0 0 1 9.75 21v-5.818a1.5 1.5 0 0 0-.44-1.06L3.13 7.938a3 3 0 0 1-.879-2.121V4.774c0-.897.64-1.683 1.542-1.836Z',
    executable: true,
    ports: { in: ['in'], out: ['true', 'false'] },
    fields: [
      { key: 'variable', label: 'Variable', type: 'variable', required: true },
      {
        key: 'operator',
        label: 'Condition',
        type: 'select',
        options: ['>', '<', '>=', '<=', '==', '!='],
        default: '>',
      },
      { key: 'value', label: 'Value', type: 'text', placeholder: 'value' },
    ],
  },
  {
    kind: 'time_window',
    category: 'condition',
    label: 'Time window',
    description: 'Continue down "yes" only during a time range on the chosen days.',
    icon: 'M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    executable: true,
    ports: { in: ['in'], out: ['true', 'false'] },
    fields: [
      { key: 'from', label: 'From', type: 'time', default: '09:00' },
      { key: 'to', label: 'To', type: 'time', default: '17:00' },
      { key: 'days', label: 'Days', type: 'weekdays', hint: 'No days = every day.' },
      { key: 'tz', label: 'Timezone', type: 'text', mono: true, placeholder: 'IANA timezone' },
    ],
  },
] as const satisfies readonly BlockManifest[];
