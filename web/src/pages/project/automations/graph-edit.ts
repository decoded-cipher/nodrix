// Converts between an AutomationGraph and Vue Flow's node/edge arrays, and the
// helpers the canvas editor needs (ids, default config, cycle check).

import type { Node, Edge } from '@vue-flow/core';
import { buildLinearGraph, findBlock, type AutomationGraph, type BlockManifest } from '@nodrix/blocks-shared';
import type { Automation } from '../../../types';

export type BlockData = { kind: string; config: Record<string, unknown> };
export type FlowNode = Node<BlockData>;

let seq = 0;
export function newNodeId(): string {
  return `n${Date.now().toString(36)}${(seq++).toString(36)}`;
}

// Default config for a freshly-added node: the manifest field defaults.
export function defaultConfig(manifest: BlockManifest): Record<string, unknown> {
  const cfg: Record<string, unknown> = {};
  for (const f of manifest.fields) if (f.default !== undefined) cfg[f.key] = f.default;
  return cfg;
}

// Existing automation → flow. Prefers the persisted graph; falls back to the
// legacy columns; a brand-new automation starts empty.
export function automationToFlow(a: Automation | null): { nodes: FlowNode[]; edges: Edge[] } {
  if (!a) return { nodes: [], edges: [] };
  const graph: AutomationGraph = a.graph ?? buildLinearGraph(
    a.trigger_type,
    (a.trigger_config ?? {}) as Record<string, unknown>,
    Array.isArray(a.actions) ? a.actions : []
  );
  return graphToFlow(graph);
}

export function graphToFlow(graph: AutomationGraph): { nodes: FlowNode[]; edges: Edge[] } {
  const nodes: FlowNode[] = graph.nodes.map((n, i) => ({
    id: n.id,
    type: 'block',
    position: { x: n.x ?? 120, y: n.y ?? 40 + i * 130 },
    data: { kind: n.kind, config: { ...n.config } },
  }));
  const edges: Edge[] = graph.edges.map((e, i) => ({
    id: `e${i}_${e.from}_${e.to}`,
    source: e.from,
    target: e.to,
    sourceHandle: e.port ?? 'out',
  }));
  return { nodes, edges };
}

export function flowToGraph(nodes: FlowNode[], edges: Edge[]): AutomationGraph {
  return {
    nodes: nodes.map((n) => ({
      id: n.id,
      kind: n.data!.kind,
      config: n.data!.config ?? {},
      x: Math.round(n.position.x),
      y: Math.round(n.position.y),
    })),
    edges: edges.map((e) => ({ from: e.source, to: e.target, port: e.sourceHandle ?? 'out' })),
  };
}

// True if adding source→target would create a cycle (target already reaches source).
export function wouldCycle(edges: Edge[], source: string, target: string): boolean {
  if (source === target) return true;
  const adj = new Map<string, string[]>();
  for (const e of edges) (adj.get(e.source) ?? adj.set(e.source, []).get(e.source)!).push(e.target);
  const seen = new Set<string>();
  const stack = [target];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === source) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    for (const next of adj.get(cur) ?? []) stack.push(next);
  }
  return false;
}

export function blockOf(kind: string): BlockManifest | undefined {
  return findBlock(kind);
}
