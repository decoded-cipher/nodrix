// Starter templates surfaced on the empty/quick-start state. Picking one opens
// the editor pre-filled (via ?recipe=<id>) with a ready-made flow graph — branches,
// conditions, multiple triggers — that the user then tweaks. Pure frontend; the
// recipe only seeds the draft and nothing persists until Save.

import type { AutomationGraph } from '@nodrix/blocks-shared';

export type Recipe = {
  id: string;
  title: string;
  description: string;
  icon: string; // 24x24 outline path
  name: string; // suggested automation name
  graph: AutomationGraph;
};

const ICON = {
  shield: 'M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z',
  sun: 'M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z',
  moon: 'M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z',
  bolt: 'M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z',
} as const;

export const RECIPES: readonly Recipe[] = [
  {
    id: 'freezer-guard',
    title: 'Freezer guard',
    description: 'On a rising freezer temp, branch: critical → alarm + alert, otherwise kick the compressor.',
    icon: ICON.shield,
    name: 'Freezer guard',
    graph: {
      nodes: [
        { id: 't', kind: 'variable', config: { variable: 'freezer_temp', operator: '>', value: -5, mode: 'edge', cooldown_seconds: 300 }, x: 80, y: 180 },
        { id: 'c', kind: 'if_variable', config: { variable: 'freezer_temp', operator: '>', value: 0 }, x: 320, y: 180 },
        { id: 'a_alarm', kind: 'set_variable', config: { variable: 'alarm', value: 1 }, x: 580, y: 80 },
        { id: 'a_alert', kind: 'emit_event', config: { event: 'freezer_critical' }, x: 820, y: 80 },
        { id: 'a_comp', kind: 'set_variable', config: { variable: 'compressor', value: 1 }, x: 580, y: 300 },
      ],
      edges: [
        { from: 't', to: 'c', port: 'out' },
        { from: 'c', to: 'a_alarm', port: 'true' },
        { from: 'a_alarm', to: 'a_alert', port: 'out' },
        { from: 'c', to: 'a_comp', port: 'false' },
      ],
    },
  },
  {
    id: 'morning-startup',
    title: 'Morning startup',
    description: 'Weekday mornings: turn on lights, set the HVAC, and broadcast a routine event.',
    icon: ICON.sun,
    name: 'Morning startup',
    graph: {
      nodes: [
        { id: 't', kind: 'schedule', config: { time: '07:00', days: [1, 2, 3, 4, 5], tz: '' }, x: 80, y: 160 },
        { id: 'a_lights', kind: 'set_variable', config: { variable: 'lights', value: 'on' }, x: 320, y: 160 },
        { id: 'a_hvac', kind: 'set_variable', config: { variable: 'hvac_setpoint', value: 21 }, x: 560, y: 160 },
        { id: 'a_evt', kind: 'emit_event', config: { event: 'morning_routine' }, x: 800, y: 160 },
      ],
      edges: [
        { from: 't', to: 'a_lights', port: 'out' },
        { from: 'a_lights', to: 'a_hvac', port: 'out' },
        { from: 'a_hvac', to: 'a_evt', port: 'out' },
      ],
    },
  },
  {
    id: 'dusk-to-dawn',
    title: 'Dusk-to-dawn lights',
    description: 'Two triggers: switch outdoor lights on at sunset and off again at sunrise.',
    icon: ICON.moon,
    name: 'Dusk-to-dawn lights',
    graph: {
      nodes: [
        { id: 't_dusk', kind: 'sunset_sunrise', config: { event: 'sunset', lat: 0, lng: 0, offset_minutes: 0 }, x: 80, y: 90 },
        { id: 'a_on', kind: 'set_variable', config: { variable: 'outdoor_lights', value: 'on' }, x: 340, y: 90 },
        { id: 't_dawn', kind: 'sunset_sunrise', config: { event: 'sunrise', lat: 0, lng: 0, offset_minutes: 0 }, x: 80, y: 290 },
        { id: 'a_off', kind: 'set_variable', config: { variable: 'outdoor_lights', value: 'off' }, x: 340, y: 290 },
      ],
      edges: [
        { from: 't_dusk', to: 'a_on', port: 'out' },
        { from: 't_dawn', to: 'a_off', port: 'out' },
      ],
    },
  },
  {
    id: 'peak-load-alert',
    title: 'Peak-load alert',
    description: 'High power draw during business hours pings an integration; off-hours it sheds load instead.',
    icon: ICON.bolt,
    name: 'Peak-load alert',
    graph: {
      nodes: [
        { id: 't', kind: 'variable', config: { variable: 'power_w', operator: '>', value: 3000, mode: 'edge', cooldown_seconds: 600 }, x: 80, y: 180 },
        { id: 'c', kind: 'time_window', config: { from: '09:00', to: '18:00', days: [1, 2, 3, 4, 5], tz: '' }, x: 320, y: 180 },
        { id: 'a_notify', kind: 'call_integration', config: { integration_id: '' }, x: 580, y: 80 },
        { id: 'a_evt', kind: 'emit_event', config: { event: 'peak_alert' }, x: 820, y: 80 },
        { id: 'a_shed', kind: 'set_variable', config: { variable: 'defer_load', value: 1 }, x: 580, y: 300 },
      ],
      edges: [
        { from: 't', to: 'c', port: 'out' },
        { from: 'c', to: 'a_notify', port: 'true' },
        { from: 'a_notify', to: 'a_evt', port: 'out' },
        { from: 'c', to: 'a_shed', port: 'false' },
      ],
    },
  },
];

export function recipeById(id: string): Recipe | undefined {
  return RECIPES.find((r) => r.id === id);
}
