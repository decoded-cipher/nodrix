// Action block manifests. Per-kind run logic lives in the worker engine.

import type { BlockManifest } from './index';

export const ACTION_CATALOG = [
  {
    kind: 'set_variable',
    category: 'action',
    label: 'Set value',
    description: 'Write a value to a variable (queued as a control write).',
    icon: 'M10.5 6h9.75M10.5 6a1.5 1.5 0 1 1-3 0m3 0a1.5 1.5 0 1 0-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 0 1-3 0m3 0a1.5 1.5 0 0 0-3 0m-9.75 0h9.75',
    executable: true,
    ports: { in: ['in'], out: ['out'] },
    fields: [
      { key: 'variable', label: 'Variable', type: 'variable', required: true },
      { key: 'value', label: 'Value', type: 'text', placeholder: 'value' },
    ],
  },
  {
    kind: 'call_integration',
    category: 'action',
    label: 'Integration',
    description: 'Invoke a configured integration (webhook, HTTP, email, …).',
    icon: 'm3.75 13.5 10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75Z',
    executable: true,
    ports: { in: ['in'], out: ['out'] },
    fields: [
      { key: 'integration_id', label: 'Integration', type: 'integration', required: true },
    ],
  },
  {
    kind: 'emit_event',
    category: 'action',
    label: 'Emit',
    description: 'Fire a named event that other event-triggered automations can react to.',
    icon: 'M10.34 15.84c-.688-.06-1.386-.09-2.09-.09H7.5a4.5 4.5 0 1 1 0-9h.75c.704 0 1.402-.03 2.09-.09m0 9.18c.253.962.584 1.892.985 2.783.247.55.06 1.21-.463 1.511l-.657.38c-.551.318-1.26.117-1.527-.461a20.845 20.845 0 0 1-1.44-4.282m3.102.069a18.03 18.03 0 0 1-.59-4.59c0-1.586.205-3.124.59-4.59m0 9.18a23.848 23.848 0 0 1 8.835 2.535M10.34 6.66a23.847 23.847 0 0 0 8.835-2.535m0 0A23.74 23.74 0 0 0 18.795 3m.38 1.125a23.91 23.91 0 0 1 1.014 5.395m-1.014 8.855c-.118.38-.245.754-.38 1.125m.38-1.125a23.91 23.91 0 0 0 1.014-5.395m0-3.46c.495.413.811 1.035.811 1.73 0 .695-.316 1.317-.811 1.73m0-3.46a24.347 24.347 0 0 1 0 3.46',
    executable: true,
    ports: { in: ['in'] },
    fields: [
      { key: 'event', label: 'Event name', type: 'text', required: true, mono: true, placeholder: 'event name' },
    ],
  },
] as const satisfies readonly BlockManifest[];
