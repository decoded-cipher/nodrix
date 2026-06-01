// The automation flow-graph model + pure helpers, shared by the worker engine
// (executor, scheduler, hot path) and the web editor (canvas, validation, save).

import { VALID_TRIGGER_KINDS, VALID_ACTION_KINDS, VALID_CONDITION_KINDS } from './index';

export type GraphNode = {
  id: string;
  kind: string;                        // trigger/action kind from the catalog
  config: Record<string, unknown>;
  x?: number;                          // canvas position (editor only)
  y?: number;
};

export type GraphEdge = {
  from: string;                        // source node id
  to: string;                          // target node id
  port?: string;                       // source output port; default 'out'
};

export type AutomationGraph = { nodes: GraphNode[]; edges: GraphEdge[] };

// Builds a linear trigger → action chain from legacy parts. Shared by the worker
// convert-on-read shim and the editor's "open a pre-graph automation" path.
export function buildLinearGraph(
  triggerKind: string | undefined,
  triggerConfig: Record<string, unknown>,
  actions: unknown[]
): AutomationGraph {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];

  if (triggerKind && VALID_TRIGGER_KINDS.has(triggerKind)) {
    nodes.push({ id: 'trigger', kind: triggerKind, config: triggerConfig ?? {} });
  }

  let prev: string | null = nodes.length ? 'trigger' : null;
  let i = 0;
  for (const raw of actions) {
    if (!raw || typeof raw !== 'object') continue;
    const { type, ...config } = raw as Record<string, unknown> & { type?: unknown };
    if (typeof type !== 'string' || !VALID_ACTION_KINDS.has(type)) continue;
    const id = `a${i++}`;
    nodes.push({ id, kind: type, config });
    if (prev) edges.push({ from: prev, to: id, port: 'out' });
    prev = id;
  }

  return { nodes, edges };
}

export function isGraph(v: unknown): v is AutomationGraph {
  return !!v && typeof v === 'object'
    && Array.isArray((v as AutomationGraph).nodes)
    && Array.isArray((v as AutomationGraph).edges);
}

export function triggerNodes(graph: AutomationGraph): GraphNode[] {
  return graph.nodes.filter((n) => VALID_TRIGGER_KINDS.has(n.kind));
}

export function actionNodes(graph: AutomationGraph): GraphNode[] {
  return graph.nodes.filter((n) => VALID_ACTION_KINDS.has(n.kind));
}

export function countActionNodes(graph: AutomationGraph): number {
  return actionNodes(graph).length;
}

// Entrypoint: the first node (trigger, or the head of the action chain when a
// row has no valid trigger — keeps an orphaned automation runnable).
export function entryNode(graph: AutomationGraph): GraphNode | undefined {
  return graph.nodes[0];
}

export function nodesById(graph: AutomationGraph): Map<string, GraphNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

export function outgoingEdges(graph: AutomationGraph, nodeId: string): GraphEdge[] {
  return graph.edges.filter((e) => e.from === nodeId);
}

// ",kind,kind," membership string for the denormalized trigger_kinds column.
export function serializeTriggerKinds(graph: AutomationGraph): string {
  const kinds = [...new Set(triggerNodes(graph).map((n) => n.kind))];
  return kinds.length ? `,${kinds.join(',')},` : '';
}

// Validates a graph for saving. Returns an error message, or null if valid.
// Enforces known node kinds, edges referencing real nodes, and DAG (no cycles) —
// the executor relies on acyclicity for its bounded traversal. An empty/triggerless
// graph is allowed (a draft that simply never fires).
export function graphError(graph: AutomationGraph): string | null {
  const ids = new Set(graph.nodes.map((n) => n.id));
  for (const n of graph.nodes) {
    if (!VALID_TRIGGER_KINDS.has(n.kind) && !VALID_ACTION_KINDS.has(n.kind) && !VALID_CONDITION_KINDS.has(n.kind)) {
      return `Unknown block kind: ${n.kind}`;
    }
  }
  for (const e of graph.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) return 'An edge references a missing node.';
  }
  if (hasCycle(graph)) return 'Connections must not form a loop.';
  return null;
}

function hasCycle(graph: AutomationGraph): boolean {
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) (adj.get(e.from) ?? adj.set(e.from, []).get(e.from)!).push(e.to);

  const visiting = new Set<string>();
  const done = new Set<string>();
  const dfs = (id: string): boolean => {
    visiting.add(id);
    for (const to of adj.get(id) ?? []) {
      if (visiting.has(to)) return true;          // back-edge → cycle
      if (!done.has(to) && dfs(to)) return true;
    }
    visiting.delete(id);
    done.add(id);
    return false;
  };
  for (const n of graph.nodes) if (!done.has(n.id) && dfs(n.id)) return true;
  return false;
}
