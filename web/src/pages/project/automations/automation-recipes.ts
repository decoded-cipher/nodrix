// Starter templates surfaced on the empty/quick-start state. Picking one opens
// the editor pre-filled (via ?recipe=<id>), so a blank project isn't a blank
// form. Pure frontend — recipes only seed the draft.

import type { AutomationTriggerType } from '../../../types';

export type Recipe = {
  id: string;
  title: string;
  description: string;
  icon: string; // 24x24 outline path
  trigger_type: AutomationTriggerType;
  name: string;                              // suggested automation name
  trigger_config: Record<string, unknown>;  // merged over the trigger default
  actions: Record<string, unknown>[];        // seeded action list
};

const ICON = {
  alert: 'M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z',
  sun: 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
  clock: 'M12 6v6l4 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  bell: 'M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0',
} as const;

export const RECIPES: readonly Recipe[] = [
  {
    id: 'threshold-alert',
    title: 'Threshold alert',
    description: 'Notify a connection when a reading crosses a limit.',
    icon: ICON.alert,
    trigger_type: 'variable',
    name: 'Threshold alert',
    trigger_config: { operator: '>', value: '', mode: 'edge' },
    actions: [{ type: 'call_integration', integration_id: '' }],
  },
  {
    id: 'sunset-light',
    title: 'Sunset light',
    description: 'Turn something on at local sunset.',
    icon: ICON.sun,
    trigger_type: 'sunset_sunrise',
    name: 'Sunset light',
    trigger_config: { event: 'sunset', offset_minutes: 0 },
    actions: [{ type: 'set_variable', variable: '', value: 'on' }],
  },
  {
    id: 'daily-scene',
    title: 'Daily scene',
    description: 'Run a set of actions at a time each day.',
    icon: ICON.clock,
    trigger_type: 'schedule',
    name: 'Daily scene',
    trigger_config: { time: '08:00', days: [] },
    actions: [{ type: 'set_variable', variable: '', value: '' }],
  },
  {
    id: 'event-notify',
    title: 'Event notifier',
    description: 'Call a connection when hardware posts an event.',
    icon: ICON.bell,
    trigger_type: 'event',
    name: 'Event notifier',
    trigger_config: { event: '' },
    actions: [{ type: 'call_integration', integration_id: '' }],
  },
];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}
