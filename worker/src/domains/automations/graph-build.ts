// Service-side graph helpers: derive the persisted columns from a canonical
// graph (graph is the source of truth; legacy trigger_type/trigger_config/actions
// are kept populated for back-compat + the convert-on-read fallback).

import {
  triggerNodes, actionNodes, serializeTriggerKinds,
  type AutomationGraph,
} from '@nodrix/blocks-shared';

export { buildLinearGraph, isGraph, graphError, type AutomationGraph } from '@nodrix/blocks-shared';

export function graphColumns(graph: AutomationGraph): {
  graph: string;
  trigger_kinds: string;
  trigger_type: string;
  trigger_config: string;
  actions: string;
} {
  const primary = triggerNodes(graph)[0];
  return {
    graph: JSON.stringify(graph),
    trigger_kinds: serializeTriggerKinds(graph),
    trigger_type: primary?.kind ?? 'manual',
    trigger_config: JSON.stringify(primary?.config ?? {}),
    actions: JSON.stringify(actionNodes(graph).map((n) => ({ type: n.kind, ...n.config }))),
  };
}

export function hasScheduledTrigger(graph: AutomationGraph): boolean {
  return triggerNodes(graph).some((n) => n.kind === 'schedule' || n.kind === 'sunset_sunrise');
}
