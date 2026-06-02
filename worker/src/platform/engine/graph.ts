// Resolves an automation row to its executable graph from the persisted `graph`
// column (the source of truth). Pure graph helpers live in @nodrix/blocks-shared.

import { isGraph, type AutomationGraph } from '@nodrix/blocks-shared';
import type { AutomationRow } from './types';

export {
  triggerNodes,
  entryNode,
  nodesById,
  outgoingEdges,
  countActionNodes,
} from '@nodrix/blocks-shared';

const EMPTY: AutomationGraph = { nodes: [], edges: [] };

export function toGraph(row: AutomationRow): AutomationGraph {
  if (!row.graph) return EMPTY;
  try {
    const parsed = JSON.parse(row.graph);
    return isGraph(parsed) ? parsed : EMPTY;
  } catch {
    return EMPTY;
  }
}
