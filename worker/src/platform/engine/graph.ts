// Builds the executable graph for an automation. Until the editor persists graphs
// directly, this rebuilds the linear trigger → action chain from the legacy
// trigger_type/trigger_config/actions columns (convert-on-read).

import { VALID_TRIGGER_KINDS, VALID_ACTION_KINDS } from '@nodrix/blocks-shared';
import type { AutomationGraph, GraphEdge, GraphNode, AutomationRow } from './types';

// Trigger entrypoint nodes (≥1 ⇒ multi-trigger). The hot path / scheduler / event
// dispatch iterate these and enter the executor at the matched node.
export function triggerNodes(graph: AutomationGraph): GraphNode[] {
  return graph.nodes.filter((n) => VALID_TRIGGER_KINDS.has(n.kind));
}

const TRIGGER_NODE_ID = 'trigger';

export function toGraph(row: AutomationRow): AutomationGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  if (VALID_TRIGGER_KINDS.has(row.trigger_type)) {
    nodes.push({ id: TRIGGER_NODE_ID, kind: row.trigger_type, config: safeObject(row.trigger_config) });
  }

  let prev: string | null = nodes.length ? TRIGGER_NODE_ID : null;
  parseActions(row.actions).forEach((a, i) => {
    const { type, ...config } = a;
    const id = `a${i}`;
    nodes.push({ id, kind: String(type), config });
    if (prev) edges.push({ from: prev, to: id, port: 'out' });
    prev = id;
  });

  return { nodes, edges };
}

// Entrypoint: the trigger node, or the head of the action chain if the row has no
// valid trigger (keeps a manual/orphaned automation runnable, matching prior behavior).
export function entryNode(graph: AutomationGraph): GraphNode | undefined {
  return graph.nodes[0];
}

export function nodesById(graph: AutomationGraph): Map<string, GraphNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

export function outgoingEdges(graph: AutomationGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.from === nodeId);
}

export function countActionNodes(graph: AutomationGraph): number {
  return graph.nodes.filter((n) => VALID_ACTION_KINDS.has(n.kind)).length;
}

function parseActions(raw: string): Array<Record<string, unknown> & { type: string }> {
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (a): a is Record<string, unknown> & { type: string } =>
      !!a && typeof a === 'object' && VALID_ACTION_KINDS.has((a as { type?: unknown }).type as string)
  );
}

function safeObject(raw: string): Record<string, unknown> {
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
