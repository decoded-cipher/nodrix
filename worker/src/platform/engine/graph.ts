// Resolves an automation row to its executable graph: the persisted `graph`
// column when present, else the legacy trigger_config/actions columns rebuilt
// into a linear chain. Pure graph helpers live in @nodrix/blocks-shared.

import { buildLinearGraph, isGraph, type AutomationGraph } from '@nodrix/blocks-shared';
import type { AutomationRow } from './types';

export {
  triggerNodes,
  entryNode,
  nodesById,
  outgoingEdges,
  countActionNodes,
} from '@nodrix/blocks-shared';

export function toGraph(row: AutomationRow): AutomationGraph {
  if (row.graph) {
    try {
      const parsed = JSON.parse(row.graph);
      if (isGraph(parsed)) return parsed;
    } catch { /* fall back to legacy columns */ }
  }
  return buildLinearGraph(row.trigger_type, safeObject(row.trigger_config), safeArray(row.actions));
}

function safeObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function safeArray(raw: string): unknown[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
