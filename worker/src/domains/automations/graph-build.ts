// Service-side graph helpers. The graph is the single source of truth; we persist
// it plus two cheap denormalized columns: trigger_kinds (multi-trigger lookups)
// and trigger_type (the indexed scan). The legacy { trigger_config, actions } view
// is derived on read for the API response, not stored.

import {
  triggerNodes, actionNodes, serializeTriggerKinds,
  type AutomationGraph,
} from '@nodrix/blocks-shared';

export { buildLinearGraph, isGraph, graphError, type AutomationGraph } from '@nodrix/blocks-shared';

export function graphColumns(graph: AutomationGraph): {
  graph: string;
  trigger_kinds: string;
  trigger_type: string;
} {
  return {
    graph: JSON.stringify(graph),
    trigger_kinds: serializeTriggerKinds(graph),
    trigger_type: triggerNodes(graph)[0]?.kind ?? 'manual',
  };
}

// Legacy { trigger_config, actions } view derived from the graph — for the admin
// API response shape only (those columns no longer exist).
export function legacyView(graph: AutomationGraph): {
  trigger_config: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
} {
  return {
    trigger_config: triggerNodes(graph)[0]?.config ?? {},
    actions: actionNodes(graph).map((n) => ({ type: n.kind, ...n.config })),
  };
}

export function hasScheduledTrigger(graph: AutomationGraph): boolean {
  return triggerNodes(graph).some((n) => n.kind === 'schedule' || n.kind === 'sunset_sunrise');
}
